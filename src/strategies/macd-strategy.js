import { MACD } from './indicators.js';

/**
 * MACD Strategy
 * - MACD crosses above Signal: BUY signal
 * - MACD crosses below Signal: SELL signal
 */
class MACDStrategy {
  constructor(options = {}) {
    this.name = 'MACD';
    this.fastPeriod = options.fastPeriod || 12;
    this.slowPeriod = options.slowPeriod || 26;
    this.signalPeriod = options.signalPeriod || 9;
    this.histogramThreshold = options.histogramThreshold || 0;
  }

  /**
   * Analyze OHLCV data and generate trading signal
   * @param {Array} ohlcv - Array of [timestamp, open, high, low, close, volume]
   * @returns {Object} { signal, strength, indicators, reason }
   */
  analyze(ohlcv) {
    if (ohlcv.length < this.slowPeriod + this.signalPeriod) {
      return {
        signal: 'HOLD',
        strength: 0,
        indicators: {},
        reason: 'Insufficient data for MACD calculation'
      };
    }

    const closes = ohlcv.map(c => c[4]);
    const macdResult = MACD(closes, this.fastPeriod, this.slowPeriod, this.signalPeriod);

    const currentMACD = macdResult.macd[macdResult.macd.length - 1];
    const previousMACD = macdResult.macd[macdResult.macd.length - 2];
    const currentSignal = macdResult.signal[macdResult.signal.length - 1];
    const previousSignal = macdResult.signal[macdResult.signal.length - 2];
    const currentHistogram = macdResult.histogram[macdResult.histogram.length - 1];
    const previousHistogram = macdResult.histogram[macdResult.histogram.length - 2];

    if (currentMACD === null || currentSignal === null) {
      return {
        signal: 'HOLD',
        strength: 0,
        indicators: {},
        reason: 'MACD values not yet available'
      };
    }

    const result = {
      signal: 'HOLD',
      strength: 0,
      indicators: {
        macd: currentMACD,
        signal: currentSignal,
        histogram: currentHistogram,
        previousMACD,
        previousSignal,
        previousHistogram
      },
      reason: ''
    };

    // Bullish crossover: MACD crosses above Signal
    const bullishCrossover = previousMACD <= previousSignal && currentMACD > currentSignal;
    // Bearish crossover: MACD crosses below Signal
    const bearishCrossover = previousMACD >= previousSignal && currentMACD < currentSignal;

    // Histogram momentum
    const histogramIncreasing = currentHistogram > previousHistogram;
    const histogramDecreasing = currentHistogram < previousHistogram;

    if (bullishCrossover) {
      result.signal = 'BUY';
      result.strength = this.calculateStrength(currentHistogram, 'bullish', currentMACD);
      result.reason = `MACD bullish crossover (MACD: ${currentMACD.toFixed(4)}, Signal: ${currentSignal.toFixed(4)})`;
    } else if (bearishCrossover) {
      result.signal = 'SELL';
      result.strength = this.calculateStrength(currentHistogram, 'bearish', currentMACD);
      result.reason = `MACD bearish crossover (MACD: ${currentMACD.toFixed(4)}, Signal: ${currentSignal.toFixed(4)})`;
    }
    // No crossover but strong histogram momentum
    else if (currentMACD > currentSignal && histogramIncreasing && currentHistogram > 0) {
      result.signal = 'BUY';
      result.strength = 0.5;
      result.reason = `MACD above signal with increasing momentum`;
    } else if (currentMACD < currentSignal && histogramDecreasing && currentHistogram < 0) {
      result.signal = 'SELL';
      result.strength = 0.5;
      result.reason = `MACD below signal with decreasing momentum`;
    }
    // Zero line crossover
    else if (previousMACD <= 0 && currentMACD > 0) {
      result.signal = 'BUY';
      result.strength = 0.4;
      result.reason = `MACD crossed above zero line`;
    } else if (previousMACD >= 0 && currentMACD < 0) {
      result.signal = 'SELL';
      result.strength = 0.4;
      result.reason = `MACD crossed below zero line`;
    } else {
      result.reason = `MACD: ${currentMACD.toFixed(4)}, Signal: ${currentSignal.toFixed(4)}, Histogram: ${currentHistogram.toFixed(4)}`;
    }

    return result;
  }

  /**
   * Calculate signal strength based on histogram and MACD values
   */
  calculateStrength(histogram, condition, macd) {
    const histogramStrength = Math.min(Math.abs(histogram) * 10, 1);

    if (condition === 'bullish') {
      // Stronger signal when histogram is positive and growing
      return Math.min(0.7 + histogramStrength * 0.3, 1.0);
    } else if (condition === 'bearish') {
      // Stronger signal when histogram is negative and shrinking
      return Math.min(0.7 + histogramStrength * 0.3, 1.0);
    }
    return 0.5;
  }

  /**
   * Get optimal parameters for this strategy
   */
  getParameters() {
    return {
      fastPeriod: this.fastPeriod,
      slowPeriod: this.slowPeriod,
      signalPeriod: this.signalPeriod,
      histogramThreshold: this.histogramThreshold
    };
  }

  /**
   * Set parameters
   */
  setParameters(params) {
    if (params.fastPeriod) this.fastPeriod = params.fastPeriod;
    if (params.slowPeriod) this.slowPeriod = params.slowPeriod;
    if (params.signalPeriod) this.signalPeriod = params.signalPeriod;
    if (params.histogramThreshold !== undefined) this.histogramThreshold = params.histogramThreshold;
  }
}

export default MACDStrategy;
