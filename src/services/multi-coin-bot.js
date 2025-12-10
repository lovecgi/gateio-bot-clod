import exchangeService from './exchange.js';
import database from '../models/database.js';
import RSIStrategy from '../strategies/rsi-strategy.js';
import MACDStrategy from '../strategies/macd-strategy.js';
import BollingerStrategy from '../strategies/bollinger-strategy.js';
import StochasticStrategy from '../strategies/stochastic-strategy.js';
import CombinedStrategy from '../strategies/combined-strategy.js';

/**
 * Multi-Coin Trading Bot
 * Manages automated trading for multiple trading pairs simultaneously
 */
class MultiCoinBot {
  constructor() {
    this.isRunning = false;
    this.coins = {}; // { symbol: { strategy, position, config } }
    this.timeframe = process.env.TIMEFRAME || '5m';
    this.defaultLeverage = parseInt(process.env.LEVERAGE) || 10;
    this.defaultPositionSize = parseFloat(process.env.POSITION_SIZE) || 100;
    this.defaultStrategy = process.env.STRATEGY || 'Combined';

    this.maxPositions = 5;
    this.intervalId = null;

    // Risk management
    this.stopLossPercent = 2;
    this.takeProfitPercent = 4;
    this.trailingStopEnabled = false;
    this.trailingStopPercent = 1;
    this.dailyLossLimit = 50;
    this.dailyLoss = 0;

    // Global statistics
    this.stats = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalPnl: 0,
      activeSince: null
    };
  }

  /**
   * Create strategy instance
   */
  createStrategy(strategyName) {
    const strategies = {
      'RSI': RSIStrategy,
      'MACD': MACDStrategy,
      'Bollinger': BollingerStrategy,
      'Stochastic': StochasticStrategy,
      'Combined': CombinedStrategy
    };

    const StrategyClass = strategies[strategyName] || CombinedStrategy;
    return new StrategyClass();
  }

  /**
   * Add a coin to the bot
   */
  async addCoin(symbol, config = {}) {
    if (this.coins[symbol]) {
      return { success: false, message: `${symbol} is already being tracked` };
    }

    const strategyName = config.strategy || this.defaultStrategy;

    this.coins[symbol] = {
      symbol,
      strategy: this.createStrategy(strategyName),
      strategyName,
      position: null,
      leverage: config.leverage || this.defaultLeverage,
      positionSize: config.positionSize || this.defaultPositionSize,
      enabled: true,
      lastSignal: null,
      stats: {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        totalPnl: 0
      }
    };

    console.log(`Added ${symbol} with ${strategyName} strategy`);

    return {
      success: true,
      message: `${symbol} added to multi-coin bot`,
      coin: this.getCoinInfo(symbol)
    };
  }

  /**
   * Remove a coin from the bot
   */
  async removeCoin(symbol, closePosition = false) {
    if (!this.coins[symbol]) {
      return { success: false, message: `${symbol} is not being tracked` };
    }

    // Close position if requested and exists
    if (closePosition && this.coins[symbol].position) {
      await this.closePosition(symbol, 'removed');
    }

    delete this.coins[symbol];

    console.log(`Removed ${symbol} from multi-coin bot`);

    return { success: true, message: `${symbol} removed from multi-coin bot` };
  }

  /**
   * Start the multi-coin bot
   */
  async start() {
    if (this.isRunning) {
      return { success: false, message: 'Multi-coin bot is already running' };
    }

    try {
      // Initialize exchange if not already done
      if (!exchangeService.initialized) {
        await exchangeService.initialize();
      }

      // Load settings
      await this.loadSettings();

      // Sync existing positions from exchange
      await this.syncAllPositions();

      this.isRunning = true;
      this.stats.activeSince = new Date();

      // Calculate interval based on timeframe
      const intervalMs = this.getIntervalMs(this.timeframe);

      // Start trading loop
      this.intervalId = setInterval(() => this.tradingLoop(), intervalMs);

      // Run immediately
      this.tradingLoop();

      console.log(`Multi-coin bot started with ${Object.keys(this.coins).length} coins`);

      return {
        success: true,
        message: 'Multi-coin bot started',
        coins: Object.keys(this.coins),
        config: this.getConfig()
      };
    } catch (error) {
      console.error('Failed to start multi-coin bot:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Stop the multi-coin bot
   */
  async stop(closePositions = false) {
    if (!this.isRunning) {
      return { success: false, message: 'Multi-coin bot is not running' };
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Close all positions if requested
    if (closePositions) {
      await this.closeAllPositions();
    }

    this.isRunning = false;

    console.log('Multi-coin bot stopped');

    return {
      success: true,
      message: 'Multi-coin bot stopped',
      stats: this.stats
    };
  }

  /**
   * Main trading loop - processes all coins
   */
  async tradingLoop() {
    console.log(`[${new Date().toISOString()}] Multi-coin trading loop started`);

    // Check daily loss limit
    if (this.dailyLoss >= this.dailyLossLimit) {
      console.log('Daily loss limit reached. Skipping trading.');
      return;
    }

    // Process each coin in parallel
    const promises = Object.keys(this.coins).map(symbol => this.processCoin(symbol));
    await Promise.allSettled(promises);
  }

  /**
   * Process a single coin
   */
  async processCoin(symbol) {
    const coin = this.coins[symbol];
    if (!coin || !coin.enabled) return;

    try {
      // Get OHLCV data
      const ohlcv = await exchangeService.getOHLCV(symbol, this.timeframe, 100);

      if (!ohlcv || ohlcv.length < 50) {
        console.log(`${symbol}: Insufficient data`);
        return;
      }

      // Analyze with strategy
      const analysis = coin.strategy.analyze(ohlcv);
      coin.lastSignal = analysis;

      console.log(`${symbol} - Signal: ${analysis.signal}, Strength: ${(analysis.strength * 100).toFixed(1)}%`);

      // Update position from exchange
      await this.updatePositionState(symbol);

      // Execute trading logic
      if (coin.position) {
        // Already in position - check for exit or management
        await this.managePosition(symbol, analysis, ohlcv);
      } else {
        // Check if we can open new positions
        const activePositions = this.getActivePositionsCount();

        if (activePositions < this.maxPositions) {
          // No position - check for entry
          if (analysis.signal === 'BUY' && analysis.strength >= 0.6) {
            await this.openLong(symbol, analysis);
          } else if (analysis.signal === 'SELL' && analysis.strength >= 0.6) {
            await this.openShort(symbol, analysis);
          }
        }
      }
    } catch (error) {
      console.error(`Error processing ${symbol}:`, error.message);
    }
  }

  /**
   * Open a long position for a coin
   */
  async openLong(symbol, analysis) {
    const coin = this.coins[symbol];
    if (!coin) return;

    try {
      console.log(`Opening LONG position for ${symbol}`);

      // Calculate position size
      const positionCalc = await exchangeService.calculatePositionSize(
        symbol,
        coin.positionSize,
        coin.leverage
      );

      // Set leverage
      await exchangeService.setLeverage(symbol, coin.leverage);

      // Place market buy order
      const order = await exchangeService.createMarketOrder(
        symbol,
        'buy',
        positionCalc.contracts,
        { leverage: coin.leverage }
      );

      // Calculate stop loss and take profit
      const entryPrice = order.price;
      const stopLoss = entryPrice * (1 - this.stopLossPercent / 100);
      const takeProfit = entryPrice * (1 + this.takeProfitPercent / 100);

      // Save position
      coin.position = {
        symbol,
        side: 'long',
        amount: order.filled,
        entryPrice,
        leverage: coin.leverage,
        stopLoss,
        takeProfit,
        openedAt: new Date()
      };

      // Save to database
      await database.addPosition({
        symbol,
        side: 'long',
        amount: order.filled,
        entry_price: entryPrice,
        leverage: coin.leverage,
        stop_loss: stopLoss,
        take_profit: takeProfit
      });

      // Record trade
      await database.addTrade({
        symbol,
        side: 'buy',
        type: 'market',
        amount: order.filled,
        price: entryPrice,
        leverage: coin.leverage,
        status: 'closed',
        strategy: coin.strategyName
      });

      console.log(`LONG position opened: ${order.filled} ${symbol} at ${entryPrice}`);

    } catch (error) {
      console.error(`Failed to open long position for ${symbol}:`, error.message);
    }
  }

  /**
   * Open a short position for a coin
   */
  async openShort(symbol, analysis) {
    const coin = this.coins[symbol];
    if (!coin) return;

    try {
      console.log(`Opening SHORT position for ${symbol}`);

      // Calculate position size
      const positionCalc = await exchangeService.calculatePositionSize(
        symbol,
        coin.positionSize,
        coin.leverage
      );

      // Set leverage
      await exchangeService.setLeverage(symbol, coin.leverage);

      // Place market sell order
      const order = await exchangeService.createMarketOrder(
        symbol,
        'sell',
        positionCalc.contracts,
        { leverage: coin.leverage }
      );

      // Calculate stop loss and take profit
      const entryPrice = order.price;
      const stopLoss = entryPrice * (1 + this.stopLossPercent / 100);
      const takeProfit = entryPrice * (1 - this.takeProfitPercent / 100);

      // Save position
      coin.position = {
        symbol,
        side: 'short',
        amount: order.filled,
        entryPrice,
        leverage: coin.leverage,
        stopLoss,
        takeProfit,
        openedAt: new Date()
      };

      // Save to database
      await database.addPosition({
        symbol,
        side: 'short',
        amount: order.filled,
        entry_price: entryPrice,
        leverage: coin.leverage,
        stop_loss: stopLoss,
        take_profit: takeProfit
      });

      // Record trade
      await database.addTrade({
        symbol,
        side: 'sell',
        type: 'market',
        amount: order.filled,
        price: entryPrice,
        leverage: coin.leverage,
        status: 'closed',
        strategy: coin.strategyName
      });

      console.log(`SHORT position opened: ${order.filled} ${symbol} at ${entryPrice}`);

    } catch (error) {
      console.error(`Failed to open short position for ${symbol}:`, error.message);
    }
  }

  /**
   * Manage existing position
   */
  async managePosition(symbol, analysis, ohlcv) {
    const coin = this.coins[symbol];
    if (!coin || !coin.position) return;

    try {
      const currentPrice = ohlcv[ohlcv.length - 1][4];
      const { entryPrice, side, amount, stopLoss, takeProfit } = coin.position;

      // Calculate unrealized PnL
      let pnl = 0;
      if (side === 'long') {
        pnl = (currentPrice - entryPrice) * amount;
      } else {
        pnl = (entryPrice - currentPrice) * amount;
      }

      // Check stop loss
      if (stopLoss) {
        if ((side === 'long' && currentPrice <= stopLoss) ||
            (side === 'short' && currentPrice >= stopLoss)) {
          console.log(`${symbol}: Stop loss triggered at ${currentPrice}`);
          await this.closePosition(symbol, 'stop_loss');
          return;
        }
      }

      // Check take profit
      if (takeProfit) {
        if ((side === 'long' && currentPrice >= takeProfit) ||
            (side === 'short' && currentPrice <= takeProfit)) {
          console.log(`${symbol}: Take profit triggered at ${currentPrice}`);
          await this.closePosition(symbol, 'take_profit');
          return;
        }
      }

      // Trailing stop management
      if (this.trailingStopEnabled && pnl > 0) {
        const trailingStopPrice = side === 'long'
          ? currentPrice * (1 - this.trailingStopPercent / 100)
          : currentPrice * (1 + this.trailingStopPercent / 100);

        if (side === 'long' && trailingStopPrice > (stopLoss || 0)) {
          coin.position.stopLoss = trailingStopPrice;
          await database.updatePosition(symbol, { stop_loss: trailingStopPrice });
        } else if (side === 'short' && (!stopLoss || trailingStopPrice < stopLoss)) {
          coin.position.stopLoss = trailingStopPrice;
          await database.updatePosition(symbol, { stop_loss: trailingStopPrice });
        }
      }

      // Check for exit signals
      const oppositeSignal = (side === 'long' && analysis.signal === 'SELL') ||
                           (side === 'short' && analysis.signal === 'BUY');

      if (oppositeSignal && analysis.strength >= 0.7) {
        console.log(`${symbol}: Exit signal received: ${analysis.signal}`);
        await this.closePosition(symbol, 'signal');
      }

    } catch (error) {
      console.error(`Position management error for ${symbol}:`, error.message);
    }
  }

  /**
   * Close position for a specific coin
   */
  async closePosition(symbol, reason = 'manual') {
    const coin = this.coins[symbol];
    if (!coin || !coin.position) {
      return { success: false, message: `No position to close for ${symbol}` };
    }

    try {
      const { side, amount, entryPrice } = coin.position;

      // Close position on exchange
      const order = await exchangeService.closePosition(symbol, side, amount);

      // Calculate PnL
      const exitPrice = order.price;
      let pnl = 0;
      if (side === 'long') {
        pnl = (exitPrice - entryPrice) * amount;
      } else {
        pnl = (entryPrice - exitPrice) * amount;
      }

      // Update statistics
      this.stats.totalTrades++;
      this.stats.totalPnl += pnl;
      coin.stats.totalTrades++;
      coin.stats.totalPnl += pnl;

      if (pnl > 0) {
        this.stats.winningTrades++;
        coin.stats.winningTrades++;
      } else {
        this.stats.losingTrades++;
        coin.stats.losingTrades++;
        this.dailyLoss += Math.abs(pnl);
      }

      // Update database
      await database.closePosition(symbol, pnl);
      await database.addTrade({
        symbol,
        side: side === 'long' ? 'sell' : 'buy',
        type: 'market',
        amount,
        price: exitPrice,
        leverage: coin.leverage,
        pnl,
        status: 'closed',
        strategy: coin.strategyName
      });

      console.log(`${symbol}: Position closed at ${exitPrice}, PnL: ${pnl.toFixed(2)} USD (${reason})`);

      coin.position = null;

      return {
        success: true,
        symbol,
        pnl,
        reason
      };

    } catch (error) {
      console.error(`Failed to close position for ${symbol}:`, error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Close all positions
   */
  async closeAllPositions() {
    const results = [];

    for (const symbol of Object.keys(this.coins)) {
      if (this.coins[symbol].position) {
        const result = await this.closePosition(symbol, 'close_all');
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Sync all positions from exchange
   */
  async syncAllPositions() {
    try {
      const positions = await exchangeService.getPositions();

      for (const pos of positions) {
        const baseSymbol = pos.symbol.split(':')[0];

        // Add coin if not tracked
        if (!this.coins[baseSymbol]) {
          await this.addCoin(baseSymbol);
        }

        // Update position
        this.coins[baseSymbol].position = {
          symbol: baseSymbol,
          side: pos.side,
          amount: pos.contracts,
          entryPrice: pos.entryPrice,
          leverage: pos.leverage,
          unrealizedPnl: pos.unrealizedPnl,
          stopLoss: pos.entryPrice * (1 - (pos.side === 'long' ? 1 : -1) * this.stopLossPercent / 100),
          takeProfit: pos.entryPrice * (1 + (pos.side === 'long' ? 1 : -1) * this.takeProfitPercent / 100)
        };

        console.log(`Synced position: ${pos.side} ${pos.contracts} ${baseSymbol}`);

        // Update database
        const dbPosition = await database.getPositionBySymbol(baseSymbol);
        if (!dbPosition) {
          await database.addPosition({
            symbol: baseSymbol,
            side: pos.side,
            amount: pos.contracts,
            entry_price: pos.entryPrice,
            leverage: pos.leverage,
            stop_loss: this.coins[baseSymbol].position.stopLoss,
            take_profit: this.coins[baseSymbol].position.takeProfit
          });
        }
      }
    } catch (error) {
      console.error('Failed to sync positions:', error.message);
    }
  }

  /**
   * Update position state for a specific coin
   */
  async updatePositionState(symbol) {
    try {
      const positions = await exchangeService.getPositions(symbol);
      const coin = this.coins[symbol];

      if (!coin) return;

      if (positions.length > 0) {
        const pos = positions[0];
        if (coin.position) {
          coin.position.unrealizedPnl = pos.unrealizedPnl;
          coin.position.markPrice = pos.markPrice;
        }
      } else if (coin.position) {
        // Position was closed externally
        console.log(`${symbol}: Position closed externally`);
        await database.closePosition(symbol, 0);
        coin.position = null;
      }
    } catch (error) {
      console.error(`Failed to update position state for ${symbol}:`, error.message);
    }
  }

  /**
   * Load settings from database
   */
  async loadSettings() {
    const settings = await database.getSettings();

    if (settings.timeframe) this.timeframe = settings.timeframe;
    if (settings.leverage) this.defaultLeverage = parseInt(settings.leverage);
    if (settings.position_size) this.defaultPositionSize = parseFloat(settings.position_size);
    if (settings.strategy) this.defaultStrategy = settings.strategy;
    if (settings.max_positions) this.maxPositions = parseInt(settings.max_positions);
    if (settings.stop_loss_percent) this.stopLossPercent = parseFloat(settings.stop_loss_percent);
    if (settings.take_profit_percent) this.takeProfitPercent = parseFloat(settings.take_profit_percent);
    if (settings.trailing_stop) this.trailingStopEnabled = settings.trailing_stop === 'true';
    if (settings.trailing_stop_percent) this.trailingStopPercent = parseFloat(settings.trailing_stop_percent);
    if (settings.daily_loss_limit) this.dailyLossLimit = parseFloat(settings.daily_loss_limit);
  }

  /**
   * Get active positions count
   */
  getActivePositionsCount() {
    return Object.values(this.coins).filter(c => c.position !== null).length;
  }

  /**
   * Get all positions
   */
  getAllPositions() {
    const positions = [];
    for (const [symbol, coin] of Object.entries(this.coins)) {
      if (coin.position) {
        positions.push({
          ...coin.position,
          strategyName: coin.strategyName
        });
      }
    }
    return positions;
  }

  /**
   * Get coin info
   */
  getCoinInfo(symbol) {
    const coin = this.coins[symbol];
    if (!coin) return null;

    return {
      symbol: coin.symbol,
      strategyName: coin.strategyName,
      leverage: coin.leverage,
      positionSize: coin.positionSize,
      enabled: coin.enabled,
      position: coin.position,
      lastSignal: coin.lastSignal,
      stats: coin.stats
    };
  }

  /**
   * Get all coins info
   */
  getAllCoinsInfo() {
    return Object.keys(this.coins).map(symbol => this.getCoinInfo(symbol));
  }

  /**
   * Update coin configuration
   */
  async updateCoinConfig(symbol, config) {
    const coin = this.coins[symbol];
    if (!coin) {
      return { success: false, message: `${symbol} is not being tracked` };
    }

    if (config.strategy) {
      coin.strategyName = config.strategy;
      coin.strategy = this.createStrategy(config.strategy);
    }
    if (config.leverage) coin.leverage = parseInt(config.leverage);
    if (config.positionSize) coin.positionSize = parseFloat(config.positionSize);
    if (config.enabled !== undefined) coin.enabled = config.enabled;

    return {
      success: true,
      coin: this.getCoinInfo(symbol)
    };
  }

  /**
   * Get bot configuration
   */
  getConfig() {
    return {
      timeframe: this.timeframe,
      defaultLeverage: this.defaultLeverage,
      defaultPositionSize: this.defaultPositionSize,
      defaultStrategy: this.defaultStrategy,
      maxPositions: this.maxPositions,
      stopLossPercent: this.stopLossPercent,
      takeProfitPercent: this.takeProfitPercent,
      trailingStopEnabled: this.trailingStopEnabled,
      trailingStopPercent: this.trailingStopPercent,
      dailyLossLimit: this.dailyLossLimit
    };
  }

  /**
   * Update bot configuration
   */
  async updateConfig(config) {
    if (config.timeframe) {
      this.timeframe = config.timeframe;
      await database.setSetting('timeframe', config.timeframe);

      // Restart interval if running
      if (this.isRunning && this.intervalId) {
        clearInterval(this.intervalId);
        const intervalMs = this.getIntervalMs(this.timeframe);
        this.intervalId = setInterval(() => this.tradingLoop(), intervalMs);
      }
    }
    if (config.defaultLeverage) {
      this.defaultLeverage = parseInt(config.defaultLeverage);
      await database.setSetting('leverage', config.defaultLeverage.toString());
    }
    if (config.defaultPositionSize) {
      this.defaultPositionSize = parseFloat(config.defaultPositionSize);
      await database.setSetting('position_size', config.defaultPositionSize.toString());
    }
    if (config.defaultStrategy) {
      this.defaultStrategy = config.defaultStrategy;
      await database.setSetting('strategy', config.defaultStrategy);
    }
    if (config.maxPositions) {
      this.maxPositions = parseInt(config.maxPositions);
      await database.setSetting('max_positions', config.maxPositions.toString());
    }
    if (config.stopLossPercent) {
      this.stopLossPercent = parseFloat(config.stopLossPercent);
      await database.setSetting('stop_loss_percent', config.stopLossPercent.toString());
    }
    if (config.takeProfitPercent) {
      this.takeProfitPercent = parseFloat(config.takeProfitPercent);
      await database.setSetting('take_profit_percent', config.takeProfitPercent.toString());
    }
    if (config.trailingStopEnabled !== undefined) {
      this.trailingStopEnabled = config.trailingStopEnabled;
      await database.setSetting('trailing_stop', config.trailingStopEnabled.toString());
    }
    if (config.trailingStopPercent) {
      this.trailingStopPercent = parseFloat(config.trailingStopPercent);
      await database.setSetting('trailing_stop_percent', config.trailingStopPercent.toString());
    }
    if (config.dailyLossLimit) {
      this.dailyLossLimit = parseFloat(config.dailyLossLimit);
      await database.setSetting('daily_loss_limit', config.dailyLossLimit.toString());
    }

    return this.getConfig();
  }

  /**
   * Get bot status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      config: this.getConfig(),
      coins: this.getAllCoinsInfo(),
      positions: this.getAllPositions(),
      stats: this.stats,
      activePositions: this.getActivePositionsCount(),
      dailyLoss: this.dailyLoss
    };
  }

  /**
   * Get interval milliseconds from timeframe string
   */
  getIntervalMs(timeframe) {
    const units = {
      'm': 60 * 1000,
      'h': 60 * 60 * 1000,
      'd': 24 * 60 * 60 * 1000
    };

    const unit = timeframe.slice(-1);
    const value = parseInt(timeframe.slice(0, -1));

    return value * (units[unit] || units['m']);
  }

  /**
   * Reset daily loss counter
   */
  resetDailyLoss() {
    this.dailyLoss = 0;
  }

  /**
   * Get available strategies
   */
  getAvailableStrategies() {
    return ['RSI', 'MACD', 'Bollinger', 'Stochastic', 'Combined'];
  }
}

// Singleton instance
const multiCoinBot = new MultiCoinBot();

export default multiCoinBot;
