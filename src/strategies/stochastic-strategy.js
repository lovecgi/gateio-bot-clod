import { Stochastic } from './indicators.js';

/**
 * Stochastic Oscillator Strategy
 * - %K crosses above %D in oversold zone (< 20): BUY signal
 * - %K crosses below %D in overbought zone (> 80): SELL signal
 */
class StochasticStrategy {
  constructor(options = {}) {
    this.name = 'Stochastic';
    this.kPeriod = options.kPeriod || 14;
    this.dPeriod = options.dPeriod || 3;
    this.oversoldLevel = options.oversoldLevel || 20;
    this.overboughtLevel = options.overboughtLevel || 80;
  }

  /**
   * Analyze OHLCV data and generate trading signal
   * @param {Array} ohlcv - Array of [timestamp, open, high, low, close, volume]
   * @returns {Object} { signal, strength, indicators, reason }
   */
  analyze(ohlcv) {
    if (ohlcv.length < this.kPeriod + this.dPeriod) {
      return {
        signal: 'HOLD',
        strength: 0,
        indicators: {},
        reason: 'Insufficient data for Stochastic calculation'
      };
    }

    const highs = ohlcv.map(c => c[2]);
    const lows = ohlcv.map(c => c[3]);
    const closes = ohlcv.map(c => c[4]);

    const stoch = Stochastic(highs, lows, closes, this.kPeriod, this.dPeriod);

    const currentK = stoch.k[stoch.k.length - 1];
    const previousK = stoch.k[stoch.k.length - 2];
    const currentD = stoch.d[stoch.d.length - 1];
    const previousD = stoch.d[stoch.d.length - 2];

    if (currentK === null || currentD === null) {
      return {
        signal: 'HOLD',
        strength: 0,
        indicators: {},
        reason: 'Stochastic values not yet available'
      };
    }

    const result = {
      signal: 'HOLD',
      strength: 0,
      indicators: {
        k: currentK,
        d: currentD,
        previousK,
        previousD,
        oversoldLevel: this.oversoldLevel,
        overboughtLevel: this.overboughtLevel
      },
      reason: ''
    };

    // Bullish crossover in oversold zone
    const bullishCrossover = previousK <= previousD && currentK > currentD;
    const inOversoldZone = currentK <= this.oversoldLevel || currentD <= this.oversoldLevel;

    // Bearish crossover in overbought zone
    const bearishCrossover = previousK >= previousD && currentK < currentD;
    const inOverboughtZone = currentK >= this.overboughtLevel || currentD >= this.overboughtLevel;

    if (bullishCrossover && inOversoldZone) {
      result.signal = 'BUY';
      result.strength = this.calculateStrength(currentK, 'buy');
      result.reason = `Bullish crossover in oversold zone (%K: ${currentK.toFixed(2)}, %D: ${currentD.toFixed(2)})`;
    } else if (bearishCrossover && inOverboughtZone) {
      result.signal = 'SELL';
      result.strength = this.calculateStrength(currentK, 'sell');
      result.reason = `Bearish crossover in overbought zone (%K: ${currentK.toFixed(2)}, %D: ${currentD.toFixed(2)})`;
    }
    // Crossover without being in extreme zones (weaker signal)
    else if (bullishCrossover) {
      result.signal = 'BUY';
      result.strength = 0.5;
      result.reason = `Bullish crossover (%K: ${currentK.toFixed(2)} crossed above %D: ${currentD.toFixed(2)})`;
    } else if (bearishCrossover) {
      result.signal = 'SELL';
      result.strength = 0.5;
      result.reason = `Bearish crossover (%K: ${currentK.toFixed(2)} crossed below %D: ${currentD.toFixed(2)})`;
    }
    // Extreme zone without crossover
    else if (currentK <= this.oversoldLevel && currentK > previousK) {
      result.signal = 'BUY';
      result.strength = 0.4;
      result.reason = `Oversold with upward momentum (%K: ${currentK.toFixed(2)})`;
    } else if (currentK >= this.overboughtLevel && currentK < previousK) {
      result.signal = 'SELL';
      result.strength = 0.4;
      result.reason = `Overbought with downward momentum (%K: ${currentK.toFixed(2)})`;
    } else {
      result.reason = `%K: ${currentK.toFixed(2)}, %D: ${currentD.toFixed(2)}`;
    }

    return result;
  }

  /**
   * Calculate signal strength based on K value
   */
  calculateStrength(k, condition) {
    if (condition === 'buy') {
      // Lower K = stronger buy signal
      if (k <= 5) return 1.0;
      if (k <= 10) return 0.9;
      if (k <= 15) return 0.85;
      if (k <= 20) return 0.8;
      return 0.7;
    } else if (condition === 'sell') {
      // Higher K = stronger sell signal
      if (k >= 95) return 1.0;
      if (k >= 90) return 0.9;
      if (k >= 85) return 0.85;
      if (k >= 80) return 0.8;
      return 0.7;
    }
    return 0.5;
  }

  /**
   * Get optimal parameters for this strategy
   */
  getParameters() {
    return {
      kPeriod: this.kPeriod,
      dPeriod: this.dPeriod,
      oversoldLevel: this.oversoldLevel,
      overboughtLevel: this.overboughtLevel
    };
  }

  /**
   * Set parameters
   */
  setParameters(params) {
    if (params.kPeriod) this.kPeriod = params.kPeriod;
    if (params.dPeriod) this.dPeriod = params.dPeriod;
    if (params.oversoldLevel) this.oversoldLevel = params.oversoldLevel;
    if (params.overboughtLevel) this.overboughtLevel = params.overboughtLevel;
  }
}

export default StochasticStrategy;
