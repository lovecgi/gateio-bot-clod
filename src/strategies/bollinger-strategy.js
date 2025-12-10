import { BollingerBands, RSI } from './indicators.js';

/**
 * Bollinger Bands Strategy
 * - Price <= Lower Band: BUY signal (potential reversal)
 * - Price >= Upper Band: SELL signal (potential reversal)
 */
class BollingerStrategy {
  constructor(options = {}) {
    this.name = 'Bollinger';
    this.period = options.period || 20;
    this.stdDev = options.stdDev || 2;
    this.useRSIConfirmation = options.useRSIConfirmation !== false;
    this.rsiPeriod = options.rsiPeriod || 14;
  }

  /**
   * Analyze OHLCV data and generate trading signal
   * @param {Array} ohlcv - Array of [timestamp, open, high, low, close, volume]
   * @returns {Object} { signal, strength, indicators, reason }
   */
  analyze(ohlcv) {
    if (ohlcv.length < this.period) {
      return {
        signal: 'HOLD',
        strength: 0,
        indicators: {},
        reason: 'Insufficient data for Bollinger Bands calculation'
      };
    }

    const closes = ohlcv.map(c => c[4]);
    const bb = BollingerBands(closes, this.period, this.stdDev);
    const currentPrice = closes[closes.length - 1];
    const previousPrice = closes[closes.length - 2];

    const currentUpper = bb.upper[bb.upper.length - 1];
    const currentMiddle = bb.middle[bb.middle.length - 1];
    const currentLower = bb.lower[bb.lower.length - 1];
    const previousLower = bb.lower[bb.lower.length - 2];
    const previousUpper = bb.upper[bb.upper.length - 2];

    // Calculate bandwidth and %B
    const bandwidth = (currentUpper - currentLower) / currentMiddle * 100;
    const percentB = (currentPrice - currentLower) / (currentUpper - currentLower);

    // Optional RSI confirmation
    let rsiValue = null;
    if (this.useRSIConfirmation) {
      const rsiValues = RSI(closes, this.rsiPeriod);
      rsiValue = rsiValues[rsiValues.length - 1];
    }

    const result = {
      signal: 'HOLD',
      strength: 0,
      indicators: {
        upper: currentUpper,
        middle: currentMiddle,
        lower: currentLower,
        price: currentPrice,
        bandwidth,
        percentB,
        rsi: rsiValue
      },
      reason: ''
    };

    // Price at or below lower band - potential BUY
    if (currentPrice <= currentLower) {
      let strength = this.calculateStrength(percentB, 'buy');

      // RSI confirmation for oversold
      if (this.useRSIConfirmation && rsiValue !== null) {
        if (rsiValue <= 30) {
          strength = Math.min(strength + 0.2, 1.0);
          result.reason = `Price at lower band (${currentPrice.toFixed(2)} <= ${currentLower.toFixed(2)}) with RSI oversold (${rsiValue.toFixed(2)})`;
        } else {
          result.reason = `Price at lower band (${currentPrice.toFixed(2)} <= ${currentLower.toFixed(2)})`;
        }
      } else {
        result.reason = `Price at lower band (${currentPrice.toFixed(2)} <= ${currentLower.toFixed(2)})`;
      }

      result.signal = 'BUY';
      result.strength = strength;
    }
    // Price bouncing off lower band
    else if (previousPrice <= previousLower && currentPrice > currentLower) {
      result.signal = 'BUY';
      result.strength = 0.8;
      result.reason = `Price bounced off lower band`;
    }
    // Price at or above upper band - potential SELL
    else if (currentPrice >= currentUpper) {
      let strength = this.calculateStrength(percentB, 'sell');

      // RSI confirmation for overbought
      if (this.useRSIConfirmation && rsiValue !== null) {
        if (rsiValue >= 70) {
          strength = Math.min(strength + 0.2, 1.0);
          result.reason = `Price at upper band (${currentPrice.toFixed(2)} >= ${currentUpper.toFixed(2)}) with RSI overbought (${rsiValue.toFixed(2)})`;
        } else {
          result.reason = `Price at upper band (${currentPrice.toFixed(2)} >= ${currentUpper.toFixed(2)})`;
        }
      } else {
        result.reason = `Price at upper band (${currentPrice.toFixed(2)} >= ${currentUpper.toFixed(2)})`;
      }

      result.signal = 'SELL';
      result.strength = strength;
    }
    // Price rejected from upper band
    else if (previousPrice >= previousUpper && currentPrice < currentUpper) {
      result.signal = 'SELL';
      result.strength = 0.8;
      result.reason = `Price rejected from upper band`;
    }
    // Middle band crossovers (weaker signals)
    else if (previousPrice < currentMiddle && currentPrice >= currentMiddle) {
      result.signal = 'BUY';
      result.strength = 0.4;
      result.reason = `Price crossed above middle band`;
    } else if (previousPrice > currentMiddle && currentPrice <= currentMiddle) {
      result.signal = 'SELL';
      result.strength = 0.4;
      result.reason = `Price crossed below middle band`;
    } else {
      result.reason = `Price between bands (%B: ${(percentB * 100).toFixed(1)}%)`;
    }

    return result;
  }

  /**
   * Calculate signal strength based on %B value
   */
  calculateStrength(percentB, condition) {
    if (condition === 'buy') {
      // Lower %B = stronger buy signal
      if (percentB <= -0.1) return 1.0;
      if (percentB <= 0) return 0.9;
      if (percentB <= 0.1) return 0.8;
      return 0.7;
    } else if (condition === 'sell') {
      // Higher %B = stronger sell signal
      if (percentB >= 1.1) return 1.0;
      if (percentB >= 1.0) return 0.9;
      if (percentB >= 0.9) return 0.8;
      return 0.7;
    }
    return 0.5;
  }

  /**
   * Get optimal parameters for this strategy
   */
  getParameters() {
    return {
      period: this.period,
      stdDev: this.stdDev,
      useRSIConfirmation: this.useRSIConfirmation,
      rsiPeriod: this.rsiPeriod
    };
  }

  /**
   * Set parameters
   */
  setParameters(params) {
    if (params.period) this.period = params.period;
    if (params.stdDev) this.stdDev = params.stdDev;
    if (params.useRSIConfirmation !== undefined) this.useRSIConfirmation = params.useRSIConfirmation;
    if (params.rsiPeriod) this.rsiPeriod = params.rsiPeriod;
  }
}

export default BollingerStrategy;
