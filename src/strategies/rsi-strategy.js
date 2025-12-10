import { RSI, calculateAllIndicators } from './indicators.js';

/**
 * RSI Strategy
 * - Oversold (RSI <= 30): BUY signal
 * - Overbought (RSI >= 70): SELL signal
 */
class RSIStrategy {
  constructor(options = {}) {
    this.name = 'RSI';
    this.period = options.period || 14;
    this.oversoldLevel = options.oversoldLevel || 30;
    this.overboughtLevel = options.overboughtLevel || 70;
    this.confirmationCandles = options.confirmationCandles || 1;
  }

  /**
   * Analyze OHLCV data and generate trading signal
   * @param {Array} ohlcv - Array of [timestamp, open, high, low, close, volume]
   * @returns {Object} { signal, strength, indicators, reason }
   */
  analyze(ohlcv) {
    if (ohlcv.length < this.period + 1) {
      return {
        signal: 'HOLD',
        strength: 0,
        indicators: {},
        reason: 'Insufficient data for RSI calculation'
      };
    }

    const closes = ohlcv.map(c => c[4]);
    const rsiValues = RSI(closes, this.period);
    const currentRSI = rsiValues[rsiValues.length - 1];
    const previousRSI = rsiValues[rsiValues.length - 2];

    const result = {
      signal: 'HOLD',
      strength: 0,
      indicators: {
        rsi: currentRSI,
        previousRSI,
        period: this.period,
        oversoldLevel: this.oversoldLevel,
        overboughtLevel: this.overboughtLevel
      },
      reason: ''
    };

    // Oversold - potential BUY
    if (currentRSI <= this.oversoldLevel) {
      // Check for RSI turning up (momentum shift)
      if (currentRSI > previousRSI) {
        result.signal = 'BUY';
        result.strength = this.calculateStrength(currentRSI, 'oversold');
        result.reason = `RSI oversold at ${currentRSI.toFixed(2)} and turning up`;
      } else {
        result.signal = 'BUY';
        result.strength = this.calculateStrength(currentRSI, 'oversold') * 0.7;
        result.reason = `RSI oversold at ${currentRSI.toFixed(2)}`;
      }
    }
    // Overbought - potential SELL
    else if (currentRSI >= this.overboughtLevel) {
      // Check for RSI turning down (momentum shift)
      if (currentRSI < previousRSI) {
        result.signal = 'SELL';
        result.strength = this.calculateStrength(currentRSI, 'overbought');
        result.reason = `RSI overbought at ${currentRSI.toFixed(2)} and turning down`;
      } else {
        result.signal = 'SELL';
        result.strength = this.calculateStrength(currentRSI, 'overbought') * 0.7;
        result.reason = `RSI overbought at ${currentRSI.toFixed(2)}`;
      }
    }
    // Neutral zone
    else {
      // Check for divergences or centerline crosses
      if (previousRSI < 50 && currentRSI >= 50) {
        result.signal = 'BUY';
        result.strength = 0.3;
        result.reason = `RSI crossed above centerline (${currentRSI.toFixed(2)})`;
      } else if (previousRSI > 50 && currentRSI <= 50) {
        result.signal = 'SELL';
        result.strength = 0.3;
        result.reason = `RSI crossed below centerline (${currentRSI.toFixed(2)})`;
      } else {
        result.reason = `RSI in neutral zone at ${currentRSI.toFixed(2)}`;
      }
    }

    return result;
  }

  /**
   * Calculate signal strength based on RSI level
   */
  calculateStrength(rsi, condition) {
    if (condition === 'oversold') {
      // Lower RSI = stronger buy signal
      if (rsi <= 10) return 1.0;
      if (rsi <= 20) return 0.9;
      if (rsi <= 25) return 0.8;
      return 0.7;
    } else if (condition === 'overbought') {
      // Higher RSI = stronger sell signal
      if (rsi >= 90) return 1.0;
      if (rsi >= 80) return 0.9;
      if (rsi >= 75) return 0.8;
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
      oversoldLevel: this.oversoldLevel,
      overboughtLevel: this.overboughtLevel,
      confirmationCandles: this.confirmationCandles
    };
  }

  /**
   * Set parameters
   */
  setParameters(params) {
    if (params.period) this.period = params.period;
    if (params.oversoldLevel) this.oversoldLevel = params.oversoldLevel;
    if (params.overboughtLevel) this.overboughtLevel = params.overboughtLevel;
    if (params.confirmationCandles) this.confirmationCandles = params.confirmationCandles;
  }
}

export default RSIStrategy;
