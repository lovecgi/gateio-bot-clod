import exchangeService from './exchange.js';
import database from '../models/database.js';
import RSIStrategy from '../strategies/rsi-strategy.js';
import MACDStrategy from '../strategies/macd-strategy.js';
import BollingerStrategy from '../strategies/bollinger-strategy.js';
import StochasticStrategy from '../strategies/stochastic-strategy.js';
import CombinedStrategy from '../strategies/combined-strategy.js';

/**
 * Single Coin Trading Bot
 * Manages automated trading for a single trading pair
 */
class TradingBot {
  constructor() {
    this.isRunning = false;
    this.symbol = process.env.TRADING_PAIR || 'BTC/USDT';
    this.timeframe = process.env.TIMEFRAME || '5m';
    this.leverage = parseInt(process.env.LEVERAGE) || 10;
    this.positionSize = parseFloat(process.env.POSITION_SIZE) || 100;
    this.riskPercentage = parseFloat(process.env.RISK_PERCENTAGE) || 2;

    this.strategy = null;
    this.strategyName = process.env.STRATEGY || 'Combined';
    this.position = null;
    this.lastSignal = null;
    this.intervalId = null;

    // Risk management settings
    this.stopLossEnabled = true;
    this.stopLossPercent = 2;
    this.takeProfitEnabled = true;
    this.takeProfitPercent = 4;
    this.trailingStopEnabled = false;
    this.trailingStopPercent = 1;
    this.dailyLossLimit = 10;
    this.dailyLoss = 0;

    // Statistics
    this.stats = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalPnl: 0
    };

    this.initializeStrategy();
  }

  /**
   * Initialize the trading strategy
   */
  initializeStrategy() {
    const strategies = {
      'RSI': RSIStrategy,
      'MACD': MACDStrategy,
      'Bollinger': BollingerStrategy,
      'Stochastic': StochasticStrategy,
      'Combined': CombinedStrategy
    };

    const StrategyClass = strategies[this.strategyName] || CombinedStrategy;
    this.strategy = new StrategyClass();

    console.log(`Strategy initialized: ${this.strategyName}`);
  }

  /**
   * Start the trading bot
   */
  async start() {
    if (this.isRunning) {
      console.log('Bot is already running');
      return { success: false, message: 'Bot is already running' };
    }

    try {
      // Initialize exchange if not already done
      if (!exchangeService.initialized) {
        await exchangeService.initialize();
      }

      // Load settings from database
      await this.loadSettings();

      // Sync existing positions from exchange
      await this.syncPositions();

      this.isRunning = true;
      await database.setSetting('bot_running', 'true');

      // Calculate interval based on timeframe
      const intervalMs = this.getIntervalMs(this.timeframe);

      // Start trading loop
      this.intervalId = setInterval(() => this.tradingLoop(), intervalMs);

      // Run immediately
      this.tradingLoop();

      console.log(`Bot started for ${this.symbol} with ${this.strategyName} strategy`);

      return {
        success: true,
        message: `Bot started for ${this.symbol}`,
        config: this.getConfig()
      };
    } catch (error) {
      console.error('Failed to start bot:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Stop the trading bot
   */
  async stop() {
    if (!this.isRunning) {
      console.log('Bot is not running');
      return { success: false, message: 'Bot is not running' };
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    await database.setSetting('bot_running', 'false');

    console.log('Bot stopped');

    return {
      success: true,
      message: 'Bot stopped',
      stats: this.stats
    };
  }

  /**
   * Main trading loop
   */
  async tradingLoop() {
    try {
      // Check daily loss limit
      if (this.dailyLoss >= this.dailyLossLimit) {
        console.log('Daily loss limit reached. Skipping trading.');
        return;
      }

      // Get OHLCV data
      const ohlcv = await exchangeService.getOHLCV(this.symbol, this.timeframe, 100);

      if (!ohlcv || ohlcv.length < 50) {
        console.log('Insufficient data for analysis');
        return;
      }

      // Analyze with strategy
      const analysis = this.strategy.analyze(ohlcv);
      const signal = analysis.signal;

      console.log(`[${new Date().toISOString()}] ${this.symbol} - Signal: ${signal}, Strength: ${(analysis.strength * 100).toFixed(1)}%`);

      // Update position from exchange
      await this.updatePositionState();

      // Execute trading logic
      if (this.position) {
        // Already in position - check for exit or management
        await this.managePosition(analysis, ohlcv);
      } else {
        // No position - check for entry
        if (signal === 'BUY' && analysis.strength >= 0.6) {
          await this.openLong(analysis);
        } else if (signal === 'SELL' && analysis.strength >= 0.6) {
          await this.openShort(analysis);
        }
      }

      this.lastSignal = analysis;
    } catch (error) {
      console.error('Trading loop error:', error.message);
    }
  }

  /**
   * Open a long position
   */
  async openLong(analysis) {
    try {
      console.log(`Opening LONG position for ${this.symbol}`);

      // Calculate position size
      const positionCalc = await exchangeService.calculatePositionSize(
        this.symbol,
        this.positionSize,
        this.leverage
      );

      // Set leverage
      await exchangeService.setLeverage(this.symbol, this.leverage);

      // Place market buy order
      const order = await exchangeService.createMarketOrder(
        this.symbol,
        'buy',
        positionCalc.contracts,
        { leverage: this.leverage }
      );

      // Calculate stop loss and take profit
      const entryPrice = order.price;
      const stopLoss = this.stopLossEnabled
        ? entryPrice * (1 - this.stopLossPercent / 100)
        : null;
      const takeProfit = this.takeProfitEnabled
        ? entryPrice * (1 + this.takeProfitPercent / 100)
        : null;

      // Save position
      this.position = {
        symbol: this.symbol,
        side: 'long',
        amount: order.filled,
        entryPrice,
        leverage: this.leverage,
        stopLoss,
        takeProfit,
        openedAt: new Date()
      };

      // Save to database
      await database.addPosition({
        symbol: this.symbol,
        side: 'long',
        amount: order.filled,
        entry_price: entryPrice,
        leverage: this.leverage,
        stop_loss: stopLoss,
        take_profit: takeProfit
      });

      // Record trade
      await database.addTrade({
        symbol: this.symbol,
        side: 'buy',
        type: 'market',
        amount: order.filled,
        price: entryPrice,
        leverage: this.leverage,
        status: 'closed',
        strategy: this.strategyName
      });

      console.log(`LONG position opened: ${order.filled} ${this.symbol} at ${entryPrice}`);

    } catch (error) {
      console.error('Failed to open long position:', error.message);
    }
  }

  /**
   * Open a short position
   */
  async openShort(analysis) {
    try {
      console.log(`Opening SHORT position for ${this.symbol}`);

      // Calculate position size
      const positionCalc = await exchangeService.calculatePositionSize(
        this.symbol,
        this.positionSize,
        this.leverage
      );

      // Set leverage
      await exchangeService.setLeverage(this.symbol, this.leverage);

      // Place market sell order
      const order = await exchangeService.createMarketOrder(
        this.symbol,
        'sell',
        positionCalc.contracts,
        { leverage: this.leverage }
      );

      // Calculate stop loss and take profit
      const entryPrice = order.price;
      const stopLoss = this.stopLossEnabled
        ? entryPrice * (1 + this.stopLossPercent / 100)
        : null;
      const takeProfit = this.takeProfitEnabled
        ? entryPrice * (1 - this.takeProfitPercent / 100)
        : null;

      // Save position
      this.position = {
        symbol: this.symbol,
        side: 'short',
        amount: order.filled,
        entryPrice,
        leverage: this.leverage,
        stopLoss,
        takeProfit,
        openedAt: new Date()
      };

      // Save to database
      await database.addPosition({
        symbol: this.symbol,
        side: 'short',
        amount: order.filled,
        entry_price: entryPrice,
        leverage: this.leverage,
        stop_loss: stopLoss,
        take_profit: takeProfit
      });

      // Record trade
      await database.addTrade({
        symbol: this.symbol,
        side: 'sell',
        type: 'market',
        amount: order.filled,
        price: entryPrice,
        leverage: this.leverage,
        status: 'closed',
        strategy: this.strategyName
      });

      console.log(`SHORT position opened: ${order.filled} ${this.symbol} at ${entryPrice}`);

    } catch (error) {
      console.error('Failed to open short position:', error.message);
    }
  }

  /**
   * Manage existing position (trailing stop, exit signals, etc.)
   */
  async managePosition(analysis, ohlcv) {
    try {
      const currentPrice = ohlcv[ohlcv.length - 1][4];
      const { entryPrice, side, amount, stopLoss, takeProfit } = this.position;

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
          console.log(`Stop loss triggered at ${currentPrice}`);
          await this.closePosition('stop_loss');
          return;
        }
      }

      // Check take profit
      if (takeProfit) {
        if ((side === 'long' && currentPrice >= takeProfit) ||
            (side === 'short' && currentPrice <= takeProfit)) {
          console.log(`Take profit triggered at ${currentPrice}`);
          await this.closePosition('take_profit');
          return;
        }
      }

      // Trailing stop management
      if (this.trailingStopEnabled && pnl > 0) {
        const trailingStopPrice = side === 'long'
          ? currentPrice * (1 - this.trailingStopPercent / 100)
          : currentPrice * (1 + this.trailingStopPercent / 100);

        // Update stop loss if trailing stop is better
        if (side === 'long' && trailingStopPrice > (stopLoss || 0)) {
          this.position.stopLoss = trailingStopPrice;
          await database.updatePosition(this.symbol, { stop_loss: trailingStopPrice });
          console.log(`Trailing stop updated to ${trailingStopPrice}`);
        } else if (side === 'short' && (!stopLoss || trailingStopPrice < stopLoss)) {
          this.position.stopLoss = trailingStopPrice;
          await database.updatePosition(this.symbol, { stop_loss: trailingStopPrice });
          console.log(`Trailing stop updated to ${trailingStopPrice}`);
        }
      }

      // Check for exit signals
      const oppositeSignal = (side === 'long' && analysis.signal === 'SELL') ||
                           (side === 'short' && analysis.signal === 'BUY');

      if (oppositeSignal && analysis.strength >= 0.7) {
        console.log(`Exit signal received: ${analysis.signal}`);
        await this.closePosition('signal');
      }

    } catch (error) {
      console.error('Position management error:', error.message);
    }
  }

  /**
   * Close the current position
   */
  async closePosition(reason = 'manual') {
    if (!this.position) {
      return { success: false, message: 'No position to close' };
    }

    try {
      const { symbol, side, amount, entryPrice } = this.position;

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
      if (pnl > 0) {
        this.stats.winningTrades++;
      } else {
        this.stats.losingTrades++;
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
        leverage: this.leverage,
        pnl,
        status: 'closed',
        strategy: this.strategyName
      });

      console.log(`Position closed: ${amount} ${symbol} at ${exitPrice}, PnL: ${pnl.toFixed(2)} USD (${reason})`);

      this.position = null;

      return {
        success: true,
        message: `Position closed with PnL: ${pnl.toFixed(2)} USD`,
        pnl,
        reason
      };

    } catch (error) {
      console.error('Failed to close position:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Sync positions from exchange
   */
  async syncPositions() {
    try {
      const positions = await exchangeService.getPositions(this.symbol);

      if (positions.length > 0) {
        const pos = positions[0];
        this.position = {
          symbol: this.symbol,
          side: pos.side,
          amount: pos.contracts,
          entryPrice: pos.entryPrice,
          leverage: pos.leverage,
          unrealizedPnl: pos.unrealizedPnl
        };

        console.log(`Synced position: ${pos.side} ${pos.contracts} ${this.symbol} at ${pos.entryPrice}`);

        // Update database
        const dbPosition = await database.getPositionBySymbol(this.symbol);
        if (!dbPosition) {
          await database.addPosition({
            symbol: this.symbol,
            side: pos.side,
            amount: pos.contracts,
            entry_price: pos.entryPrice,
            leverage: pos.leverage,
            stop_loss: this.calculateStopLoss(pos.entryPrice, pos.side),
            take_profit: this.calculateTakeProfit(pos.entryPrice, pos.side)
          });
        }
      } else {
        this.position = null;
      }
    } catch (error) {
      console.error('Failed to sync positions:', error.message);
    }
  }

  /**
   * Update position state from exchange
   */
  async updatePositionState() {
    try {
      const positions = await exchangeService.getPositions(this.symbol);

      if (positions.length > 0) {
        const pos = positions[0];
        if (this.position) {
          this.position.unrealizedPnl = pos.unrealizedPnl;
          this.position.markPrice = pos.markPrice;
        }
      } else if (this.position) {
        // Position was closed externally
        console.log('Position closed externally');
        await database.closePosition(this.symbol, 0);
        this.position = null;
      }
    } catch (error) {
      console.error('Failed to update position state:', error.message);
    }
  }

  /**
   * Calculate stop loss price
   */
  calculateStopLoss(entryPrice, side) {
    if (!this.stopLossEnabled) return null;

    if (side === 'long') {
      return entryPrice * (1 - this.stopLossPercent / 100);
    } else {
      return entryPrice * (1 + this.stopLossPercent / 100);
    }
  }

  /**
   * Calculate take profit price
   */
  calculateTakeProfit(entryPrice, side) {
    if (!this.takeProfitEnabled) return null;

    if (side === 'long') {
      return entryPrice * (1 + this.takeProfitPercent / 100);
    } else {
      return entryPrice * (1 - this.takeProfitPercent / 100);
    }
  }

  /**
   * Load settings from database
   */
  async loadSettings() {
    const settings = await database.getSettings();

    if (settings.trading_pair) this.symbol = settings.trading_pair;
    if (settings.leverage) this.leverage = parseInt(settings.leverage);
    if (settings.position_size) this.positionSize = parseFloat(settings.position_size);
    if (settings.risk_percentage) this.riskPercentage = parseFloat(settings.risk_percentage);
    if (settings.strategy) {
      this.strategyName = settings.strategy;
      this.initializeStrategy();
    }
    if (settings.timeframe) this.timeframe = settings.timeframe;
    if (settings.auto_stop_loss) this.stopLossEnabled = settings.auto_stop_loss === 'true';
    if (settings.stop_loss_percent) this.stopLossPercent = parseFloat(settings.stop_loss_percent);
    if (settings.auto_take_profit) this.takeProfitEnabled = settings.auto_take_profit === 'true';
    if (settings.take_profit_percent) this.takeProfitPercent = parseFloat(settings.take_profit_percent);
    if (settings.trailing_stop) this.trailingStopEnabled = settings.trailing_stop === 'true';
    if (settings.trailing_stop_percent) this.trailingStopPercent = parseFloat(settings.trailing_stop_percent);
    if (settings.daily_loss_limit) this.dailyLossLimit = parseFloat(settings.daily_loss_limit);

    console.log('Settings loaded from database');
  }

  /**
   * Update bot configuration
   */
  async updateConfig(config) {
    if (config.symbol) {
      this.symbol = config.symbol;
      await database.setSetting('trading_pair', config.symbol);
    }
    if (config.leverage) {
      this.leverage = parseInt(config.leverage);
      await database.setSetting('leverage', config.leverage.toString());
    }
    if (config.positionSize) {
      this.positionSize = parseFloat(config.positionSize);
      await database.setSetting('position_size', config.positionSize.toString());
    }
    if (config.strategy) {
      this.strategyName = config.strategy;
      this.initializeStrategy();
      await database.setSetting('strategy', config.strategy);
    }
    if (config.timeframe) {
      this.timeframe = config.timeframe;
      await database.setSetting('timeframe', config.timeframe);
    }

    // Restart interval if running
    if (this.isRunning && this.intervalId) {
      clearInterval(this.intervalId);
      const intervalMs = this.getIntervalMs(this.timeframe);
      this.intervalId = setInterval(() => this.tradingLoop(), intervalMs);
    }

    return this.getConfig();
  }

  /**
   * Update risk management settings
   */
  async updateRiskSettings(settings) {
    if (settings.stopLossEnabled !== undefined) {
      this.stopLossEnabled = settings.stopLossEnabled;
      await database.setSetting('auto_stop_loss', settings.stopLossEnabled.toString());
    }
    if (settings.stopLossPercent) {
      this.stopLossPercent = parseFloat(settings.stopLossPercent);
      await database.setSetting('stop_loss_percent', settings.stopLossPercent.toString());
    }
    if (settings.takeProfitEnabled !== undefined) {
      this.takeProfitEnabled = settings.takeProfitEnabled;
      await database.setSetting('auto_take_profit', settings.takeProfitEnabled.toString());
    }
    if (settings.takeProfitPercent) {
      this.takeProfitPercent = parseFloat(settings.takeProfitPercent);
      await database.setSetting('take_profit_percent', settings.takeProfitPercent.toString());
    }
    if (settings.trailingStopEnabled !== undefined) {
      this.trailingStopEnabled = settings.trailingStopEnabled;
      await database.setSetting('trailing_stop', settings.trailingStopEnabled.toString());
    }
    if (settings.trailingStopPercent) {
      this.trailingStopPercent = parseFloat(settings.trailingStopPercent);
      await database.setSetting('trailing_stop_percent', settings.trailingStopPercent.toString());
    }
    if (settings.dailyLossLimit) {
      this.dailyLossLimit = parseFloat(settings.dailyLossLimit);
      await database.setSetting('daily_loss_limit', settings.dailyLossLimit.toString());
    }

    return this.getRiskSettings();
  }

  /**
   * Get bot configuration
   */
  getConfig() {
    return {
      symbol: this.symbol,
      timeframe: this.timeframe,
      leverage: this.leverage,
      positionSize: this.positionSize,
      riskPercentage: this.riskPercentage,
      strategy: this.strategyName
    };
  }

  /**
   * Get risk management settings
   */
  getRiskSettings() {
    return {
      stopLossEnabled: this.stopLossEnabled,
      stopLossPercent: this.stopLossPercent,
      takeProfitEnabled: this.takeProfitEnabled,
      takeProfitPercent: this.takeProfitPercent,
      trailingStopEnabled: this.trailingStopEnabled,
      trailingStopPercent: this.trailingStopPercent,
      dailyLossLimit: this.dailyLossLimit,
      dailyLoss: this.dailyLoss
    };
  }

  /**
   * Get bot status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      config: this.getConfig(),
      position: this.position,
      lastSignal: this.lastSignal,
      stats: this.stats,
      riskSettings: this.getRiskSettings()
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
const tradingBot = new TradingBot();

export default tradingBot;
