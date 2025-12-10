import database from '../models/database.js';

/**
 * Auto-Optimization Utilities
 * Automatically adjusts strategy parameters based on performance
 */
class AutoOptimizer {
  constructor() {
    this.enabled = false;
    this.optimizationInterval = 24 * 60 * 60 * 1000; // Daily
    this.minTradesForOptimization = 20;
    this.lastOptimization = null;
    this.intervalId = null;
  }

  /**
   * Start auto-optimization
   */
  start() {
    if (this.enabled) return;

    this.enabled = true;
    this.lastOptimization = new Date();

    // Run optimization periodically
    this.intervalId = setInterval(() => this.optimize(), this.optimizationInterval);

    console.log('Auto-optimizer started');
  }

  /**
   * Stop auto-optimization
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.enabled = false;
    console.log('Auto-optimizer stopped');
  }

  /**
   * Run optimization analysis
   */
  async optimize() {
    console.log('Running auto-optimization...');

    try {
      // Get recent performance data
      const stats = await database.getPerformanceStats();

      if (stats.totalTrades < this.minTradesForOptimization) {
        console.log(`Not enough trades for optimization (${stats.totalTrades}/${this.minTradesForOptimization})`);
        return null;
      }

      const recommendations = [];

      // Analyze win rate
      const winRate = parseFloat(stats.winRate);
      if (winRate < 40) {
        recommendations.push({
          parameter: 'strategy',
          current: 'Current strategy underperforming',
          suggestion: 'Consider switching to Combined strategy for more confirmations',
          priority: 'high'
        });
      }

      // Analyze profit factor
      const profitFactor = parseFloat(stats.profitFactor);
      if (profitFactor < 1) {
        recommendations.push({
          parameter: 'risk_management',
          current: `Profit factor: ${profitFactor}`,
          suggestion: 'Tighten stop losses or widen take profits',
          priority: 'high'
        });
      }

      // Analyze by strategy
      const strategyPerf = await database.getPerformanceByStrategy();
      const bestStrategy = strategyPerf.reduce((best, s) => {
        if (!best || s.total_pnl > best.total_pnl) return s;
        return best;
      }, null);

      if (bestStrategy) {
        recommendations.push({
          parameter: 'strategy',
          current: 'Strategy performance analysis',
          suggestion: `Best performing strategy: ${bestStrategy.strategy} (PnL: $${bestStrategy.total_pnl?.toFixed(2) || 0})`,
          priority: 'medium'
        });
      }

      // Analyze by coin
      const coinPerf = await database.getPerformanceByCoin();
      const worstCoins = coinPerf.filter(c => c.total_pnl < 0);

      if (worstCoins.length > 0) {
        recommendations.push({
          parameter: 'coins',
          current: 'Coin performance analysis',
          suggestion: `Consider removing underperforming coins: ${worstCoins.map(c => c.symbol).join(', ')}`,
          priority: 'medium'
        });
      }

      // Analyze drawdown
      const dailyPnl = await database.getDailyPnl(30);
      let maxDrawdown = 0;
      let peak = 0;
      let cumulative = 0;

      for (const day of dailyPnl) {
        cumulative += day.daily_pnl;
        if (cumulative > peak) peak = cumulative;
        const drawdown = peak - cumulative;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
      }

      if (maxDrawdown > 100) { // More than $100 drawdown
        recommendations.push({
          parameter: 'position_size',
          current: `Max drawdown: $${maxDrawdown.toFixed(2)}`,
          suggestion: 'Consider reducing position sizes to manage drawdown',
          priority: 'high'
        });
      }

      // Save optimization results
      this.lastOptimization = new Date();

      const result = {
        timestamp: this.lastOptimization,
        stats: {
          winRate,
          profitFactor,
          maxDrawdown,
          totalTrades: stats.totalTrades
        },
        recommendations
      };

      console.log('Optimization complete:', result);

      return result;

    } catch (error) {
      console.error('Optimization error:', error.message);
      return null;
    }
  }

  /**
   * Optimize strategy parameters
   */
  async optimizeStrategyParams(strategyName, ohlcv) {
    const paramRanges = {
      RSI: {
        period: [7, 14, 21],
        oversoldLevel: [20, 25, 30],
        overboughtLevel: [70, 75, 80]
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
        dPeriod: [3, 5, 7],
        oversoldLevel: [15, 20, 25],
        overboughtLevel: [75, 80, 85]
      }
    };

    const ranges = paramRanges[strategyName];
    if (!ranges) {
      return { error: 'Unknown strategy' };
    }

    // Generate all combinations
    const combinations = this.generateCombinations(ranges);

    // Test each combination (simplified backtest)
    const results = [];
    for (const params of combinations.slice(0, 27)) { // Limit to 27 combinations
      const score = await this.testParameters(strategyName, params, ohlcv);
      results.push({ params, score });
    }

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    return {
      strategy: strategyName,
      bestParams: results[0]?.params,
      bestScore: results[0]?.score,
      topResults: results.slice(0, 5)
    };
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
   * Test parameter set (simplified scoring)
   */
  async testParameters(strategyName, params, ohlcv) {
    // Simplified scoring based on parameter effectiveness
    // In a real implementation, this would run a backtest

    let score = 50; // Base score

    // RSI scoring
    if (strategyName === 'RSI') {
      // Prefer moderate periods
      if (params.period === 14) score += 10;
      // Prefer standard levels
      if (params.oversoldLevel === 30 && params.overboughtLevel === 70) score += 10;
    }

    // MACD scoring
    if (strategyName === 'MACD') {
      // Prefer standard settings
      if (params.fastPeriod === 12 && params.slowPeriod === 26) score += 15;
      if (params.signalPeriod === 9) score += 5;
    }

    // Add some randomness to simulate real testing variance
    score += Math.random() * 20;

    return Math.round(score);
  }

  /**
   * Get optimization recommendations for current performance
   */
  async getRecommendations() {
    return this.optimize();
  }

  /**
   * Get settings
   */
  getSettings() {
    return {
      enabled: this.enabled,
      optimizationInterval: this.optimizationInterval,
      minTradesForOptimization: this.minTradesForOptimization,
      lastOptimization: this.lastOptimization
    };
  }

  /**
   * Update settings
   */
  updateSettings(settings) {
    if (settings.enabled !== undefined) {
      if (settings.enabled && !this.enabled) {
        this.start();
      } else if (!settings.enabled && this.enabled) {
        this.stop();
      }
    }

    if (settings.optimizationInterval) {
      this.optimizationInterval = settings.optimizationInterval;
      // Restart interval with new timing
      if (this.enabled) {
        this.stop();
        this.start();
      }
    }

    if (settings.minTradesForOptimization) {
      this.minTradesForOptimization = settings.minTradesForOptimization;
    }

    return this.getSettings();
  }
}

// Singleton instance
const autoOptimizer = new AutoOptimizer();

export default autoOptimizer;
