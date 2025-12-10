/**
 * Technical Indicators Module
 * Calculates RSI, MACD, Bollinger Bands, Stochastic, ATR, and more
 */

/**
 * Calculate Simple Moving Average (SMA)
 * @param {number[]} data - Array of prices
 * @param {number} period - Period for SMA
 * @returns {number[]} Array of SMA values
 */
export function SMA(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }
  }
  return result;
}

/**
 * Calculate Exponential Moving Average (EMA)
 * @param {number[]} data - Array of prices
 * @param {number} period - Period for EMA
 * @returns {number[]} Array of EMA values
 */
export function EMA(data, period) {
  const result = [];
  const multiplier = 2 / (period + 1);

  // First EMA value is SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
    result.push(null);
  }
  result[period - 1] = sum / period;

  // Calculate subsequent EMA values
  for (let i = period; i < data.length; i++) {
    const ema = (data[i] - result[i - 1]) * multiplier + result[i - 1];
    result.push(ema);
  }

  return result;
}

/**
 * Calculate Relative Strength Index (RSI)
 * @param {number[]} closes - Array of closing prices
 * @param {number} period - RSI period (default 14)
 * @returns {number[]} Array of RSI values
 */
export function RSI(closes, period = 14) {
  const result = [];
  const gains = [];
  const losses = [];

  // Calculate price changes
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  // First RSI calculation uses simple average
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Fill initial null values
  for (let i = 0; i < period; i++) {
    result.push(null);
  }

  // Calculate first RSI
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push(100 - (100 / (1 + rs)));

  // Calculate subsequent RSI values using smoothed averages
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - (100 / (1 + rs)));
  }

  return result;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 * @param {number[]} closes - Array of closing prices
 * @param {number} fastPeriod - Fast EMA period (default 12)
 * @param {number} slowPeriod - Slow EMA period (default 26)
 * @param {number} signalPeriod - Signal line period (default 9)
 * @returns {Object} { macd, signal, histogram }
 */
export function MACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fastEMA = EMA(closes, fastPeriod);
  const slowEMA = EMA(closes, slowPeriod);

  // Calculate MACD line
  const macdLine = fastEMA.map((fast, i) => {
    if (fast === null || slowEMA[i] === null) return null;
    return fast - slowEMA[i];
  });

  // Calculate Signal line (EMA of MACD)
  const validMacd = macdLine.filter(v => v !== null);
  const signalEMA = EMA(validMacd, signalPeriod);

  // Align signal with macd
  const signal = [];
  let signalIndex = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] === null) {
      signal.push(null);
    } else {
      signal.push(signalEMA[signalIndex] || null);
      signalIndex++;
    }
  }

  // Calculate Histogram
  const histogram = macdLine.map((m, i) => {
    if (m === null || signal[i] === null) return null;
    return m - signal[i];
  });

  return { macd: macdLine, signal, histogram };
}

/**
 * Calculate Bollinger Bands
 * @param {number[]} closes - Array of closing prices
 * @param {number} period - Period for moving average (default 20)
 * @param {number} stdDev - Standard deviation multiplier (default 2)
 * @returns {Object} { upper, middle, lower }
 */
export function BollingerBands(closes, period = 20, stdDev = 2) {
  const middle = SMA(closes, period);
  const upper = [];
  const lower = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper.push(null);
      lower.push(null);
    } else {
      const slice = closes.slice(i - period + 1, i + 1);
      const avg = middle[i];
      const squaredDiffs = slice.map(x => Math.pow(x - avg, 2));
      const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
      const sd = Math.sqrt(variance);

      upper.push(avg + stdDev * sd);
      lower.push(avg - stdDev * sd);
    }
  }

  return { upper, middle, lower };
}

/**
 * Calculate Stochastic Oscillator
 * @param {number[]} highs - Array of high prices
 * @param {number[]} lows - Array of low prices
 * @param {number[]} closes - Array of closing prices
 * @param {number} kPeriod - %K period (default 14)
 * @param {number} dPeriod - %D smoothing period (default 3)
 * @returns {Object} { k, d }
 */
export function Stochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  const kValues = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < kPeriod - 1) {
      kValues.push(null);
    } else {
      const highSlice = highs.slice(i - kPeriod + 1, i + 1);
      const lowSlice = lows.slice(i - kPeriod + 1, i + 1);

      const highestHigh = Math.max(...highSlice);
      const lowestLow = Math.min(...lowSlice);

      if (highestHigh === lowestLow) {
        kValues.push(50); // Avoid division by zero
      } else {
        const k = ((closes[i] - lowestLow) / (highestHigh - lowestLow)) * 100;
        kValues.push(k);
      }
    }
  }

  // %D is SMA of %K
  const dValues = SMA(kValues.map(v => v === null ? 0 : v), dPeriod);

  // Adjust d values for null k values
  for (let i = 0; i < kPeriod - 1 + dPeriod - 1; i++) {
    if (i < dValues.length) dValues[i] = null;
  }

  return { k: kValues, d: dValues };
}

/**
 * Calculate Average True Range (ATR)
 * @param {number[]} highs - Array of high prices
 * @param {number[]} lows - Array of low prices
 * @param {number[]} closes - Array of closing prices
 * @param {number} period - ATR period (default 14)
 * @returns {number[]} Array of ATR values
 */
export function ATR(highs, lows, closes, period = 14) {
  const trueRanges = [];

  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      trueRanges.push(highs[i] - lows[i]);
    } else {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trueRanges.push(tr);
    }
  }

  // Calculate ATR using smoothed moving average (Wilder's smoothing)
  const result = [];
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = 0; i < period - 1; i++) {
    result.push(null);
  }
  result.push(atr);

  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    result.push(atr);
  }

  return result;
}

/**
 * Calculate Average Directional Index (ADX)
 * @param {number[]} highs - Array of high prices
 * @param {number[]} lows - Array of low prices
 * @param {number[]} closes - Array of closing prices
 * @param {number} period - ADX period (default 14)
 * @returns {Object} { adx, plusDI, minusDI }
 */
export function ADX(highs, lows, closes, period = 14) {
  const plusDM = [];
  const minusDM = [];
  const tr = [];

  for (let i = 1; i < closes.length; i++) {
    const highDiff = highs[i] - highs[i - 1];
    const lowDiff = lows[i - 1] - lows[i];

    plusDM.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
    minusDM.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);

    const trValue = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    tr.push(trValue);
  }

  // Smooth the values
  const smoothedTR = smoothWilder(tr, period);
  const smoothedPlusDM = smoothWilder(plusDM, period);
  const smoothedMinusDM = smoothWilder(minusDM, period);

  const plusDI = [];
  const minusDI = [];
  const dx = [];

  for (let i = 0; i < smoothedTR.length; i++) {
    if (smoothedTR[i] === null || smoothedTR[i] === 0) {
      plusDI.push(null);
      minusDI.push(null);
      dx.push(null);
    } else {
      const pdi = (smoothedPlusDM[i] / smoothedTR[i]) * 100;
      const mdi = (smoothedMinusDM[i] / smoothedTR[i]) * 100;
      plusDI.push(pdi);
      minusDI.push(mdi);

      const diSum = pdi + mdi;
      dx.push(diSum === 0 ? 0 : Math.abs(pdi - mdi) / diSum * 100);
    }
  }

  // ADX is smoothed DX
  const adx = smoothWilder(dx.filter(v => v !== null), period);

  // Pad with nulls to align
  const result = {
    plusDI: [null, ...plusDI],
    minusDI: [null, ...minusDI],
    adx: new Array(closes.length - adx.length).fill(null).concat(adx)
  };

  return result;
}

/**
 * Wilder's Smoothing Method
 */
function smoothWilder(data, period) {
  const result = [];
  let sum = data.slice(0, period).reduce((a, b) => a + (b || 0), 0);

  for (let i = 0; i < period - 1; i++) {
    result.push(null);
  }
  result.push(sum);

  for (let i = period; i < data.length; i++) {
    sum = sum - sum / period + (data[i] || 0);
    result.push(sum);
  }

  return result;
}

/**
 * Calculate Volume Weighted Average Price (VWAP)
 * @param {number[]} highs - Array of high prices
 * @param {number[]} lows - Array of low prices
 * @param {number[]} closes - Array of closing prices
 * @param {number[]} volumes - Array of volumes
 * @returns {number[]} Array of VWAP values
 */
export function VWAP(highs, lows, closes, volumes) {
  const result = [];
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;

  for (let i = 0; i < closes.length; i++) {
    const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
    cumulativeTPV += typicalPrice * volumes[i];
    cumulativeVolume += volumes[i];

    result.push(cumulativeVolume === 0 ? null : cumulativeTPV / cumulativeVolume);
  }

  return result;
}

/**
 * Calculate On-Balance Volume (OBV)
 * @param {number[]} closes - Array of closing prices
 * @param {number[]} volumes - Array of volumes
 * @returns {number[]} Array of OBV values
 */
export function OBV(closes, volumes) {
  const result = [volumes[0]];

  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) {
      result.push(result[i - 1] + volumes[i]);
    } else if (closes[i] < closes[i - 1]) {
      result.push(result[i - 1] - volumes[i]);
    } else {
      result.push(result[i - 1]);
    }
  }

  return result;
}

/**
 * Calculate all indicators for given OHLCV data
 * @param {Array} ohlcv - Array of [timestamp, open, high, low, close, volume]
 * @returns {Object} All calculated indicators
 */
export function calculateAllIndicators(ohlcv) {
  const opens = ohlcv.map(c => c[1]);
  const highs = ohlcv.map(c => c[2]);
  const lows = ohlcv.map(c => c[3]);
  const closes = ohlcv.map(c => c[4]);
  const volumes = ohlcv.map(c => c[5]);

  const rsi = RSI(closes, 14);
  const macd = MACD(closes, 12, 26, 9);
  const bb = BollingerBands(closes, 20, 2);
  const stoch = Stochastic(highs, lows, closes, 14, 3);
  const atr = ATR(highs, lows, closes, 14);

  return {
    rsi,
    macd,
    bollingerBands: bb,
    stochastic: stoch,
    atr,
    sma20: SMA(closes, 20),
    sma50: SMA(closes, 50),
    ema12: EMA(closes, 12),
    ema26: EMA(closes, 26),
    currentPrice: closes[closes.length - 1],
    currentRSI: rsi[rsi.length - 1],
    currentMACD: macd.macd[macd.macd.length - 1],
    currentMACDSignal: macd.signal[macd.signal.length - 1],
    currentMACDHistogram: macd.histogram[macd.histogram.length - 1],
    currentBBUpper: bb.upper[bb.upper.length - 1],
    currentBBMiddle: bb.middle[bb.middle.length - 1],
    currentBBLower: bb.lower[bb.lower.length - 1],
    currentStochK: stoch.k[stoch.k.length - 1],
    currentStochD: stoch.d[stoch.d.length - 1],
    currentATR: atr[atr.length - 1]
  };
}

export default {
  SMA,
  EMA,
  RSI,
  MACD,
  BollingerBands,
  Stochastic,
  ATR,
  ADX,
  VWAP,
  OBV,
  calculateAllIndicators
};
