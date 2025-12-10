import RSIStrategy from '../strategies/rsi-strategy.js';
import MACDStrategy from '../strategies/macd-strategy.js';
import BollingerStrategy from '../strategies/bollinger-strategy.js';
import StochasticStrategy from '../strategies/stochastic-strategy.js';
import CombinedStrategy from '../strategies/combined-strategy.js';
import database from '../models/database.js';
import exchangeService from './exchange.js';

/**
 * Backtesting Engine
 * Test trading strategies against historical data
 */
class BacktestingEngine {
  constructor() {
    this.strategies = {
      'RSI': RSIStrategy,
      'MACD': MACDStrategy,
      'Bollinger': BollingerStrategy,
      'Stochastic': StochasticStrategy,
      'Combined': CombinedStrategy
    };
  }

  /**
   * Run a backtest
   * @param {Object} params - Backtest parameters
   */
  async runBacktest(params) {
    const {
      symbol,
      strategy: strategyName,
      timeframe = '1h',
      startDate,
      endDate,
      initialBalance = 10000,
      positionSize = 100,
      leverage = 10,
      stopLossPercent = 2,
      takeProfitPercent = 4,
      strategyParams = {}
    } = params;

    console.log(`Starting backtest: ${strategyName} on ${symbol}`);

    try {
      // Get historical data
      const ohlcv = await this.getHistoricalData(symbol, timeframe, 500);

      if (!ohlcv || ohlcv.length < 100) {
        return { error: 'Insufficient historical data' };
      }

      // Initialize strategy
      const StrategyClass = this.strategies[strategyName];
      if (!StrategyClass) {
        return { error: `Unknown strategy: ${strategyName}` };
      }

      const strategy = new StrategyClass(strategyParams);

      // Run simulation
      const result = this.simulate({
        ohlcv,
        strategy,
        initialBalance,
        positionSize,
        leverage,
        stopLossPercent,
        takeProfitPercent
      });

      // Calculate statistics
      const stats = this.calculateStats(result);

      // Save result
      await database.saveBacktestResult({
        strategy: strategyName,
        symbol,
        timeframe,
        start_date: startDate || new Date(ohlcv[0][0]).toISOString(),
        end_date: endDate || new Date(ohlcv[ohlcv.length - 1][0]).toISOString(),
        initial_balance: initialBalance,
        final_balance: stats.finalBalance,
        total_trades: stats.totalTrades,
        winning_trades: stats.winningTrades,
        losing_trades: stats.losingTrades,
        win_rate: stats.winRate,
        profit_factor: stats.profitFactor,
        max_drawdown: stats.maxDrawdown,
        sharpe_ratio: stats.sharpeRatio,
        parameters: strategyParams
      });

      return {
        success: true,
        strategy: strategyName,
        symbol,
        timeframe,
        period: {
          start: new Date(ohlcv[0][0]).toISOString(),
          end: new Date(ohlcv[ohlcv.length - 1][0]).toISOString(),
          candles: ohlcv.length
        },
        initialBalance,
        ...stats,
        trades: result.trades.slice(-50), // Last 50 trades
        equityCurve: result.equityCurve
      };

    } catch (error) {
      console.error('Backtest error:', error.message);
      return { error: error.message };
    }
  }

  /**
   * Simulate trading
   */
  simulate(params) {
    const {
      ohlcv,
      strategy,
      initialBalance,
      positionSize,
      leverage,
      stopLossPercent,
      takeProfitPercent
    } = params;

    let balance = initialBalance;
    let position = null;
    const trades = [];
    const equityCurve = [];

    // Need at least 50 candles for indicators
    const startIndex = 50;

    for (let i = startIndex; i < ohlcv.length; i++) {
      const currentCandle = ohlcv[i];
      const [timestamp, open, high, low, close, volume] = currentCandle;

      // Get analysis from strategy
      const historicalData = ohlcv.slice(0, i + 1);
      const analysis = strategy.analyze(historicalData);

      // Current price
      const currentPrice = close;

      // Check position management
      if (position) {
        // Check stop loss
        if (position.side === 'long' && low <= position.stopLoss) {
          const pnl = this.calculatePnl(position, position.stopLoss, leverage);
          balance += pnl;
          trades.push({
            ...position,
            exitPrice: position.stopLoss,
            exitTime: timestamp,
            pnl,
            exitReason: 'stop_loss'
          });
          position = null;
        } else if (position.side === 'short' && high >= position.stopLoss) {
          const pnl = this.calculatePnl(position, position.stopLoss, leverage);
          balance += pnl;
          trades.push({
            ...position,
            exitPrice: position.stopLoss,
            exitTime: timestamp,
            pnl,
            exitReason: 'stop_loss'
          });
          position = null;
        }
        // Check take profit
        else if (position.side === 'long' && high >= position.takeProfit) {
          const pnl = this.calculatePnl(position, position.takeProfit, leverage);
          balance += pnl;
          trades.push({
            ...position,
            exitPrice: position.takeProfit,
            exitTime: timestamp,
            pnl,
            exitReason: 'take_profit'
          });
          position = null;
        } else if (position.side === 'short' && low <= position.takeProfit) {
          const pnl = this.calculatePnl(position, position.takeProfit, leverage);
          balance += pnl;
          trades.push({
            ...position,
            exitPrice: position.takeProfit,
            exitTime: timestamp,
            pnl,
            exitReason: 'take_profit'
          });
          position = null;
        }
        // Check exit signal
        else if (
          (position.side === 'long' && analysis.signal === 'SELL' && analysis.strength >= 0.7) ||
          (position.side === 'short' && analysis.signal === 'BUY' && analysis.strength >= 0.7)
        ) {
          const pnl = this.calculatePnl(position, currentPrice, leverage);
          balance += pnl;
          trades.push({
            ...position,
            exitPrice: currentPrice,
            exitTime: timestamp,
            pnl,
            exitReason: 'signal'
          });
          position = null;
        }
      }

      // Check entry signal
      if (!position && analysis.strength >= 0.6) {
        const contracts = (positionSize * leverage) / currentPrice;

        if (analysis.signal === 'BUY') {
          position = {
            side: 'long',
            entryPrice: currentPrice,
            entryTime: timestamp,
            contracts,
            stopLoss: currentPrice * (1 - stopLossPercent / 100),
            takeProfit: currentPrice * (1 + takeProfitPercent / 100),
            signal: analysis
          };
        } else if (analysis.signal === 'SELL') {
          position = {
            side: 'short',
            entryPrice: currentPrice,
            entryTime: timestamp,
            contracts,
            stopLoss: currentPrice * (1 + stopLossPercent / 100),
            takeProfit: currentPrice * (1 - takeProfitPercent / 100),
            signal: analysis
          };
        }
      }

      // Record equity
      let equity = balance;
      if (position) {
        const unrealizedPnl = this.calculatePnl(position, currentPrice, leverage);
        equity += unrealizedPnl;
      }

      equityCurve.push({
        timestamp,
        balance,
        equity,
        price: currentPrice
      });
    }

    // Close any remaining position
    if (position) {
      const lastCandle = ohlcv[ohlcv.length - 1];
      const pnl = this.calculatePnl(position, lastCandle[4], leverage);
      balance += pnl;
      trades.push({
        ...position,
        exitPrice: lastCandle[4],
        exitTime: lastCandle[0],
        pnl,
        exitReason: 'backtest_end'
      });
    }

    return {
      trades,
      equityCurve,
      finalBalance: balance
    };
  }

  /**
   * Calculate PnL for a position
   */
  calculatePnl(position, exitPrice, leverage) {
    const { side, entryPrice, contracts } = position;

    if (side === 'long') {
      return (exitPrice - entryPrice) * contracts;
    } else {
      return (entryPrice - exitPrice) * contracts;
    }
  }

  /**
   * Calculate statistics from backtest results
   */
  calculateStats(result) {
    const { trades, equityCurve, finalBalance } = result;

    if (trades.length === 0) {
      return {
        finalBalance,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalPnl: 0,
        avgPnl: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        maxDrawdownPercent: 0,
        sharpeRatio: 0
      };
    }

    const winningTrades = trades.filter(t => t.pnl > 0);
    const losingTrades = trades.filter(t => t.pnl <= 0);

    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));

    // Calculate drawdown
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    let peak = equityCurve[0]?.equity || finalBalance;

    for (const point of equityCurve) {
      if (point.equity > peak) {
        peak = point.equity;
      }
      const drawdown = peak - point.equity;
      const drawdownPercent = (drawdown / peak) * 100;

      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownPercent = drawdownPercent;
      }
    }

    // Calculate Sharpe Ratio
    const returns = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const ret = (equityCurve[i].equity - equityCurve[i - 1].equity) / equityCurve[i - 1].equity;
      returns.push(ret);
    }

    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdReturn = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    );

    const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0; // Annualized

    return {
      finalBalance,
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: ((winningTrades.length / trades.length) * 100).toFixed(2),
      totalPnl: totalPnl.toFixed(2),
      avgPnl: (totalPnl / trades.length).toFixed(2),
      avgWin: winningTrades.length > 0 ? (grossProfit / winningTrades.length).toFixed(2) : 0,
      avgLoss: losingTrades.length > 0 ? (grossLoss / losingTrades.length).toFixed(2) : 0,
      profitFactor: grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? 'Infinity' : 0,
      maxDrawdown: maxDrawdown.toFixed(2),
      maxDrawdownPercent: maxDrawdownPercent.toFixed(2),
      sharpeRatio: sharpeRatio.toFixed(2)
    };
  }

  /**
   * Get historical data from exchange
   */
  async getHistoricalData(symbol, timeframe, limit = 500) {
    try {
      if (!exchangeService.initialized) {
        await exchangeService.initialize();
      }

      return await exchangeService.getOHLCV(symbol, timeframe, limit);
    } catch (error) {
      console.error('Failed to get historical data:', error.message);
      throw error;
    }
  }

  /**
   * Optimize strategy parameters
   */
  async optimize(params) {
    const {
      symbol,
      strategy: strategyName,
      timeframe = '1h',
      initialBalance = 10000,
      parameterRanges
    } = params;

    console.log(`Starting optimization for ${strategyName} on ${symbol}`);

    try {
      // Get historical data
      const ohlcv = await this.getHistoricalData(symbol, timeframe, 500);

      if (!ohlcv || ohlcv.length < 100) {
        return { error: 'Insufficient historical data' };
      }

      // Default parameter ranges
      const defaultRanges = this.getDefaultParameterRanges(strategyName);
      const ranges = { ...defaultRanges, ...parameterRanges };

      // Generate combinations
      const combinations = this.generateCombinations(ranges);

      // Limit combinations
      const maxCombinations = 50;
      const testCombinations = combinations.slice(0, maxCombinations);

      console.log(`Testing ${testCombinations.length} parameter combinations`);

      const results = [];

      for (const paramSet of testCombinations) {
        const StrategyClass = this.strategies[strategyName];
        const strategy = new StrategyClass(paramSet);

        const simResult = this.simulate({
          ohlcv,
          strategy,
          initialBalance,
          positionSize: 100,
          leverage: 10,
          stopLossPercent: 2,
          takeProfitPercent: 4
        });

        const stats = this.calculateStats(simResult);

        results.push({
          parameters: paramSet,
          ...stats,
          score: this.calculateScore(stats)
        });
      }

      // Sort by score
      results.sort((a, b) => b.score - a.score);

      return {
        success: true,
        strategy: strategyName,
        symbol,
        timeframe,
        testedCombinations: results.length,
        bestResult: results[0],
        topResults: results.slice(0, 10)
      };

    } catch (error) {
      console.error('Optimization error:', error.message);
      return { error: error.message };
    }
  }

  /**
   * Get default parameter ranges for optimization
   */
  getDefaultParameterRanges(strategyName) {
    const ranges = {
      RSI: {
        period: [7, 14, 21],
        oversoldLevel: [25, 30, 35],
        overboughtLevel: [65, 70, 75]
      },
      MACD: {
        fastPeriod: [8, 12, 16],
        slowPeriod: [21, 26, 31],
        signalPeriod: [7, 9, 11]
      },
      Bollinger: {
        period: [15, 20, 25],
        stdDev: [1.5, 2, 2.5]
      },
      Stochastic: {
        kPeriod: [9, 14, 19],
        dPeriod: [3, 5],
        oversoldLevel: [15, 20, 25],
        overboughtLevel: [75, 80, 85]
      },
      Combined: {
        buyThreshold: [1.5, 2.0, 2.5],
        sellThreshold: [1.5, 2.0, 2.5],
        minAgreement: [2, 3]
      }
    };

    return ranges[strategyName] || {};
  }

  /**
   * Generate parameter combinations
   */
  generateCombinations(ranges) {
    const keys = Object.keys(ranges);
    const combinations = [];

    function generate(index, current) {
      if (index === keys.length) {
        combinations.push({ ...current });
        return;
      }

      const key = keys[index];
      for (const value of ranges[key]) {
        current[key] = value;
        generate(index + 1, current);
      }
    }

    generate(0, {});
    return combinations;
  }

  /**
   * Calculate optimization score
   */
  calculateScore(stats) {
    const winRate = parseFloat(stats.winRate) || 0;
    const profitFactor = parseFloat(stats.profitFactor) || 0;
    const totalPnl = parseFloat(stats.totalPnl) || 0;
    const maxDrawdown = parseFloat(stats.maxDrawdownPercent) || 100;
    const totalTrades = stats.totalTrades || 0;

    // Weighted score
    let score = 0;

    // Win rate contribution (0-30 points)
    score += Math.min(winRate / 100 * 30, 30);

    // Profit factor contribution (0-30 points)
    if (profitFactor !== Infinity) {
      score += Math.min(profitFactor * 10, 30);
    } else {
      score += 30;
    }

    // PnL contribution (0-20 points)
    score += Math.min(Math.max(totalPnl / 1000, -20), 20);

    // Drawdown penalty (0-20 points deducted)
    score -= Math.min(maxDrawdown / 5, 20);

    // Trade count bonus (need enough trades for statistical significance)
    if (totalTrades >= 20) {
      score += 10;
    } else if (totalTrades >= 10) {
      score += 5;
    }

    return Math.max(score, 0);
  }

  /**
   * Get available strategies
   */
  getAvailableStrategies() {
    return Object.keys(this.strategies);
  }

  /**
   * Get backtest history from database
   */
  async getHistory(limit = 50) {
    return database.getBacktestResults(limit);
  }
}

// Singleton instance
const backtestingEngine = new BacktestingEngine();

export default backtestingEngine;
