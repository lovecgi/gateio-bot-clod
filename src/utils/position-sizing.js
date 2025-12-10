import { ATR } from '../strategies/indicators.js';
import database from '../models/database.js';

/**
 * Position Sizing Utilities
 * Various methods for calculating optimal position sizes
 */
class PositionSizing {
  constructor() {
    this.method = 'fixed'; // 'fixed', 'kelly', 'volatility', 'percent_risk'
    this.kellyFraction = 0.5; // Half-Kelly for safety
    this.riskPercent = 2; // Risk 2% of capital per trade
    this.atrMultiplier = 2; // ATR multiplier for volatility-based sizing
  }

  /**
   * Calculate position size based on current method
   * @param {number} balance - Account balance
   * @param {number} price - Current price
   * @param {Object} options - Additional options
   * @returns {Object} Position size calculation
   */
  async calculatePositionSize(balance, price, options = {}) {
    const method = options.method || this.method;

    switch (method) {
      case 'kelly':
        return this.kellyPositionSize(balance, price, options);
      case 'volatility':
        return this.volatilityPositionSize(balance, price, options);
      case 'percent_risk':
        return this.percentRiskPositionSize(balance, price, options);
      case 'fixed':
      default:
        return this.fixedPositionSize(balance, price, options);
    }
  }

  /**
   * Fixed position size
   * Uses a fixed USD amount for each trade
   */
  fixedPositionSize(balance, price, options = {}) {
    const positionSize = options.positionSize || 100;
    const leverage = options.leverage || 1;

    const contracts = (positionSize * leverage) / price;
    const margin = positionSize;

    return {
      method: 'fixed',
      contracts: Math.floor(contracts * 1000) / 1000,
      positionValue: positionSize * leverage,
      margin,
      riskAmount: positionSize * (options.stopLossPercent || 2) / 100,
      leverage
    };
  }

  /**
   * Kelly Criterion position sizing
   * Calculates optimal bet size based on win rate and risk/reward ratio
   */
  async kellyPositionSize(balance, price, options = {}) {
    const leverage = options.leverage || 1;
    const stopLossPercent = options.stopLossPercent || 2;
    const takeProfitPercent = options.takeProfitPercent || 4;

    // Get historical performance
    const stats = await database.getPerformanceStats();

    // Default values if no history
    const winRate = stats.totalTrades > 0
      ? stats.winningTrades / stats.totalTrades
      : 0.5;

    const avgWin = stats.maxWin > 0 ? parseFloat(stats.maxWin) : takeProfitPercent;
    const avgLoss = stats.maxLoss < 0 ? Math.abs(parseFloat(stats.maxLoss)) : stopLossPercent;

    // Kelly formula: f = (bp - q) / b
    // where b = odds (win/loss ratio), p = win probability, q = loss probability
    const b = avgWin / avgLoss;
    const p = winRate;
    const q = 1 - winRate;

    let kellyFraction = (b * p - q) / b;

    // Apply half-Kelly for safety
    kellyFraction = kellyFraction * this.kellyFraction;

    // Clamp to reasonable bounds
    kellyFraction = Math.max(0.01, Math.min(kellyFraction, 0.25));

    // Calculate position size
    const positionValue = balance * kellyFraction * leverage;
    const contracts = positionValue / price;
    const margin = positionValue / leverage;

    return {
      method: 'kelly',
      contracts: Math.floor(contracts * 1000) / 1000,
      positionValue,
      margin,
      kellyFraction,
      fullKelly: kellyFraction / this.kellyFraction,
      winRate,
      avgWin,
      avgLoss,
      riskRewardRatio: b,
      leverage
    };
  }

  /**
   * Volatility-based position sizing (ATR)
   * Adjusts position size based on market volatility
   */
  volatilityPositionSize(balance, price, options = {}) {
    const leverage = options.leverage || 1;
    const ohlcv = options.ohlcv || [];
    const riskPercent = options.riskPercent || this.riskPercent;
    const atrMultiplier = options.atrMultiplier || this.atrMultiplier;

    // Calculate ATR if OHLCV data provided
    let atr = price * 0.02; // Default 2% if no data

    if (ohlcv.length >= 14) {
      const highs = ohlcv.map(c => c[2]);
      const lows = ohlcv.map(c => c[3]);
      const closes = ohlcv.map(c => c[4]);
      const atrValues = ATR(highs, lows, closes, 14);
      const currentATR = atrValues[atrValues.length - 1];
      if (currentATR) atr = currentATR;
    }

    // Risk amount in USD
    const riskAmount = balance * (riskPercent / 100);

    // Position size based on ATR (larger ATR = smaller position)
    const stopLossDistance = atr * atrMultiplier;
    const contracts = riskAmount / stopLossDistance;

    const positionValue = contracts * price;
    const margin = positionValue / leverage;

    return {
      method: 'volatility',
      contracts: Math.floor(contracts * 1000) / 1000,
      positionValue,
      margin,
      atr,
      atrPercent: (atr / price) * 100,
      stopLossDistance,
      riskAmount,
      riskPercent,
      leverage
    };
  }

  /**
   * Percent risk position sizing
   * Risk a fixed percentage of account on each trade
   */
  percentRiskPositionSize(balance, price, options = {}) {
    const leverage = options.leverage || 1;
    const riskPercent = options.riskPercent || this.riskPercent;
    const stopLossPercent = options.stopLossPercent || 2;

    // Calculate risk amount
    const riskAmount = balance * (riskPercent / 100);

    // Calculate position size where stop loss = risk amount
    // If price drops by stopLossPercent, we lose riskAmount
    const stopLossDistance = price * (stopLossPercent / 100);
    const contracts = riskAmount / stopLossDistance;

    const positionValue = contracts * price;
    const margin = positionValue / leverage;

    return {
      method: 'percent_risk',
      contracts: Math.floor(contracts * 1000) / 1000,
      positionValue,
      margin,
      riskAmount,
      riskPercent,
      stopLossPercent,
      stopLossDistance,
      leverage
    };
  }

  /**
   * Calculate optimal stop loss based on ATR
   */
  calculateATRStopLoss(entryPrice, side, ohlcv, multiplier = 2) {
    if (ohlcv.length < 14) {
      // Default to 2% if insufficient data
      return side === 'long'
        ? entryPrice * 0.98
        : entryPrice * 1.02;
    }

    const highs = ohlcv.map(c => c[2]);
    const lows = ohlcv.map(c => c[3]);
    const closes = ohlcv.map(c => c[4]);
    const atrValues = ATR(highs, lows, closes, 14);
    const atr = atrValues[atrValues.length - 1] || entryPrice * 0.02;

    if (side === 'long') {
      return entryPrice - (atr * multiplier);
    } else {
      return entryPrice + (atr * multiplier);
    }
  }

  /**
   * Calculate optimal take profit based on risk/reward ratio
   */
  calculateTakeProfit(entryPrice, stopLoss, side, riskRewardRatio = 2) {
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = risk * riskRewardRatio;

    if (side === 'long') {
      return entryPrice + reward;
    } else {
      return entryPrice - reward;
    }
  }

  /**
   * Calculate partial take profit levels
   */
  calculatePartialTakeProfits(entryPrice, stopLoss, side, levels = 3) {
    const risk = Math.abs(entryPrice - stopLoss);
    const profits = [];

    for (let i = 1; i <= levels; i++) {
      const reward = risk * i;
      const percentage = Math.floor(100 / levels);

      if (side === 'long') {
        profits.push({
          price: entryPrice + reward,
          percentage: i === levels ? 100 - (percentage * (levels - 1)) : percentage,
          riskRewardRatio: i
        });
      } else {
        profits.push({
          price: entryPrice - reward,
          percentage: i === levels ? 100 - (percentage * (levels - 1)) : percentage,
          riskRewardRatio: i
        });
      }
    }

    return profits;
  }

  /**
   * Calculate maximum position size based on account risk limits
   */
  calculateMaxPositionSize(balance, leverage, maxRiskPercent = 10) {
    const maxRiskAmount = balance * (maxRiskPercent / 100);
    const maxPositionValue = maxRiskAmount * leverage;

    return {
      maxPositionValue,
      maxMargin: maxRiskAmount,
      maxRiskPercent,
      leverage
    };
  }

  /**
   * Validate position size against risk limits
   */
  validatePositionSize(positionSize, balance, leverage, limits = {}) {
    const maxPositionPercent = limits.maxPositionPercent || 25; // Max 25% of balance
    const maxPositions = limits.maxPositions || 5;
    const currentPositions = limits.currentPositions || 0;

    const margin = positionSize / leverage;
    const positionPercent = (margin / balance) * 100;

    const issues = [];

    if (positionPercent > maxPositionPercent) {
      issues.push(`Position size (${positionPercent.toFixed(1)}%) exceeds max (${maxPositionPercent}%)`);
    }

    if (currentPositions >= maxPositions) {
      issues.push(`Maximum positions (${maxPositions}) reached`);
    }

    return {
      valid: issues.length === 0,
      issues,
      positionPercent,
      margin
    };
  }

  /**
   * Get current settings
   */
  getSettings() {
    return {
      method: this.method,
      kellyFraction: this.kellyFraction,
      riskPercent: this.riskPercent,
      atrMultiplier: this.atrMultiplier
    };
  }

  /**
   * Update settings
   */
  async updateSettings(settings) {
    if (settings.method) {
      this.method = settings.method;
      await database.setSetting('position_sizing_method', settings.method);
    }
    if (settings.kellyFraction !== undefined) {
      this.kellyFraction = parseFloat(settings.kellyFraction);
      await database.setSetting('kelly_fraction', settings.kellyFraction.toString());
    }
    if (settings.riskPercent !== undefined) {
      this.riskPercent = parseFloat(settings.riskPercent);
      await database.setSetting('risk_percentage', settings.riskPercent.toString());
    }
    if (settings.atrMultiplier !== undefined) {
      this.atrMultiplier = parseFloat(settings.atrMultiplier);
    }

    return this.getSettings();
  }

  /**
   * Load settings from database
   */
  async loadSettings() {
    const settings = await database.getSettings();

    if (settings.position_sizing_method) this.method = settings.position_sizing_method;
    if (settings.kelly_fraction) this.kellyFraction = parseFloat(settings.kelly_fraction);
    if (settings.risk_percentage) this.riskPercent = parseFloat(settings.risk_percentage);
  }

  /**
   * Get available methods
   */
  getAvailableMethods() {
    return [
      { id: 'fixed', name: 'Fixed Size', description: 'Use a fixed USD amount for each trade' },
      { id: 'kelly', name: 'Kelly Criterion', description: 'Optimal bet sizing based on win rate and R:R' },
      { id: 'volatility', name: 'Volatility (ATR)', description: 'Adjust size based on market volatility' },
      { id: 'percent_risk', name: 'Percent Risk', description: 'Risk a fixed % of account per trade' }
    ];
  }
}

// Singleton instance
const positionSizing = new PositionSizing();

export default positionSizing;
