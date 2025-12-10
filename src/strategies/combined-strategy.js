import RSIStrategy from './rsi-strategy.js';
import MACDStrategy from './macd-strategy.js';
import BollingerStrategy from './bollinger-strategy.js';
import StochasticStrategy from './stochastic-strategy.js';

/**
 * Combined Strategy (Voting System)
 * Combines signals from multiple strategies and uses weighted voting
 * - Buy score >= threshold: BUY signal
 * - Sell score >= threshold: SELL signal
 */
class CombinedStrategy {
  constructor(options = {}) {
    this.name = 'Combined';

    // Initialize individual strategies
    this.strategies = {
      rsi: new RSIStrategy(options.rsi || {}),
      macd: new MACDStrategy(options.macd || {}),
      bollinger: new BollingerStrategy(options.bollinger || {}),
      stochastic: new StochasticStrategy(options.stochastic || {})
    };

    // Weights for each strategy (should sum to 1 or be normalized)
    this.weights = options.weights || {
      rsi: 1.0,
      macd: 1.0,
      bollinger: 1.0,
      stochastic: 1.0
    };

    // Minimum score threshold for signals (out of max score based on weights)
    this.buyThreshold = options.buyThreshold || 2.0;
    this.sellThreshold = options.sellThreshold || 2.0;

    // Require minimum number of agreeing strategies
    this.minAgreement = options.minAgreement || 2;
  }

  /**
   * Analyze OHLCV data and generate combined trading signal
   * @param {Array} ohlcv - Array of [timestamp, open, high, low, close, volume]
   * @returns {Object} { signal, strength, indicators, reason, strategyResults }
   */
  analyze(ohlcv) {
    const results = {};
    let buyScore = 0;
    let sellScore = 0;
    let buyCount = 0;
    let sellCount = 0;
    const reasons = [];

    // Get signals from each strategy
    for (const [name, strategy] of Object.entries(this.strategies)) {
      const result = strategy.analyze(ohlcv);
      results[name] = result;

      const weight = this.weights[name] || 1.0;

      if (result.signal === 'BUY') {
        buyScore += result.strength * weight;
        buyCount++;
        reasons.push(`${name.toUpperCase()}: BUY (${(result.strength * 100).toFixed(0)}%)`);
      } else if (result.signal === 'SELL') {
        sellScore += result.strength * weight;
        sellCount++;
        reasons.push(`${name.toUpperCase()}: SELL (${(result.strength * 100).toFixed(0)}%)`);
      } else {
        reasons.push(`${name.toUpperCase()}: HOLD`);
      }
    }

    const totalWeight = Object.values(this.weights).reduce((a, b) => a + b, 0);
    const maxScore = totalWeight;

    const result = {
      signal: 'HOLD',
      strength: 0,
      indicators: {
        buyScore,
        sellScore,
        maxScore,
        buyCount,
        sellCount,
        threshold: {
          buy: this.buyThreshold,
          sell: this.sellThreshold
        }
      },
      strategyResults: results,
      reason: ''
    };

    // Determine final signal
    if (buyScore >= this.buyThreshold && buyCount >= this.minAgreement) {
      if (buyScore > sellScore) {
        result.signal = 'BUY';
        result.strength = Math.min(buyScore / maxScore, 1.0);
        result.reason = `Combined BUY signal (Score: ${buyScore.toFixed(2)}/${maxScore}, ${buyCount} strategies agree)`;
      }
    }

    if (sellScore >= this.sellThreshold && sellCount >= this.minAgreement) {
      if (sellScore > buyScore) {
        result.signal = 'SELL';
        result.strength = Math.min(sellScore / maxScore, 1.0);
        result.reason = `Combined SELL signal (Score: ${sellScore.toFixed(2)}/${maxScore}, ${sellCount} strategies agree)`;
      }
    }

    if (result.signal === 'HOLD') {
      result.reason = `No consensus (Buy: ${buyScore.toFixed(2)}, Sell: ${sellScore.toFixed(2)}, Threshold: ${this.buyThreshold})`;
    }

    // Add individual strategy reasons
    result.strategyReasons = reasons;

    return result;
  }

  /**
   * Get detailed analysis with all indicator values
   */
  getDetailedAnalysis(ohlcv) {
    const analysis = this.analyze(ohlcv);

    // Aggregate all indicators
    const allIndicators = {};
    for (const [name, result] of Object.entries(analysis.strategyResults)) {
      allIndicators[name] = result.indicators;
    }

    return {
      ...analysis,
      allIndicators
    };
  }

  /**
   * Get optimal parameters for this strategy
   */
  getParameters() {
    const params = {
      buyThreshold: this.buyThreshold,
      sellThreshold: this.sellThreshold,
      minAgreement: this.minAgreement,
      weights: this.weights,
      strategies: {}
    };

    for (const [name, strategy] of Object.entries(this.strategies)) {
      params.strategies[name] = strategy.getParameters();
    }

    return params;
  }

  /**
   * Set parameters
   */
  setParameters(params) {
    if (params.buyThreshold) this.buyThreshold = params.buyThreshold;
    if (params.sellThreshold) this.sellThreshold = params.sellThreshold;
    if (params.minAgreement) this.minAgreement = params.minAgreement;
    if (params.weights) this.weights = { ...this.weights, ...params.weights };

    if (params.strategies) {
      for (const [name, strategyParams] of Object.entries(params.strategies)) {
        if (this.strategies[name]) {
          this.strategies[name].setParameters(strategyParams);
        }
      }
    }
  }

  /**
   * Enable or disable a specific strategy
   */
  setStrategyWeight(strategyName, weight) {
    if (this.weights.hasOwnProperty(strategyName)) {
      this.weights[strategyName] = weight;
    }
  }

  /**
   * Get available strategies
   */
  getAvailableStrategies() {
    return Object.keys(this.strategies);
  }
}

export default CombinedStrategy;
