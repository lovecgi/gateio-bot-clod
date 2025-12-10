import express from 'express';
import exchangeService from '../services/exchange.js';
import tradingBot from '../services/trading-bot.js';
import multiCoinBot from '../services/multi-coin-bot.js';
import database from '../models/database.js';
import positionSizing from '../utils/position-sizing.js';
import autoOptimizer from '../utils/auto-optimizer.js';
import advancedOrdersService from '../services/advanced-orders.js';
import backtestingEngine from '../services/backtesting.js';

const router = express.Router();

// ============================================
// Health & Status
// ============================================

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

router.get('/status', (req, res) => {
  res.json({
    bot: tradingBot.getStatus(),
    exchange: exchangeService.getExchangeInfo()
  });
});

// ============================================
// Bot Control
// ============================================

router.post('/start', async (req, res) => {
  try {
    const result = await tradingBot.start();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/stop', async (req, res) => {
  try {
    const result = await tradingBot.stop();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Multi-Coin Bot
// ============================================

router.get('/multi-coin/status', (req, res) => {
  res.json(multiCoinBot.getStatus());
});

router.post('/multi-coin/start', async (req, res) => {
  try {
    const result = await multiCoinBot.start();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/multi-coin/stop', async (req, res) => {
  try {
    const closePositions = req.body.closePositions || false;
    const result = await multiCoinBot.stop(closePositions);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/multi-coin/add', async (req, res) => {
  try {
    const { symbol, strategy, leverage, positionSize } = req.body;
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }
    const result = await multiCoinBot.addCoin(symbol, { strategy, leverage, positionSize });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/multi-coin/remove/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.replace('-', '/');
    const closePosition = req.query.closePosition === 'true';
    const result = await multiCoinBot.removeCoin(symbol, closePosition);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/multi-coin/config', async (req, res) => {
  try {
    const result = await multiCoinBot.updateConfig(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/multi-coin/coin/:symbol/config', async (req, res) => {
  try {
    const symbol = req.params.symbol.replace('-', '/');
    const result = await multiCoinBot.updateCoinConfig(symbol, req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Exchange Data
// ============================================

router.get('/balance', async (req, res) => {
  try {
    const balance = await exchangeService.getBalance();
    res.json(balance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/ticker/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.replace('-', '/');
    const ticker = await exchangeService.getTicker(symbol);
    res.json(ticker);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/ohlcv/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.replace('-', '/');
    const timeframe = req.query.timeframe || '5m';
    const limit = parseInt(req.query.limit) || 100;
    const ohlcv = await exchangeService.getOHLCV(symbol, timeframe, limit);
    res.json(ohlcv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/symbols', (req, res) => {
  try {
    const symbols = exchangeService.getAvailableSymbols();
    res.json(symbols);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Positions
// ============================================

router.get('/positions', async (req, res) => {
  try {
    const positions = await exchangeService.getPositions();
    res.json(positions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/positions/db', async (req, res) => {
  try {
    const positions = await database.getOpenPositions();
    res.json(positions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/positions/:symbol/close', async (req, res) => {
  try {
    const symbol = req.params.symbol.replace('-', '/');

    // Try multi-coin bot first
    if (multiCoinBot.coins[symbol]) {
      const result = await multiCoinBot.closePosition(symbol, 'manual');
      return res.json(result);
    }

    // Try single bot
    if (tradingBot.position && tradingBot.symbol === symbol) {
      const result = await tradingBot.closePosition('manual');
      return res.json(result);
    }

    // Direct close via exchange
    const positions = await exchangeService.getPositions(symbol);
    if (positions.length > 0) {
      const result = await exchangeService.closePosition(symbol, positions[0].side);
      return res.json({ success: true, result });
    }

    res.status(404).json({ error: 'Position not found' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/positions/close-all', async (req, res) => {
  try {
    // Close multi-coin positions
    const multiResults = await multiCoinBot.closeAllPositions();

    // Close single bot position
    let singleResult = null;
    if (tradingBot.position) {
      singleResult = await tradingBot.closePosition('close_all');
    }

    // Close any remaining exchange positions
    const exchangeResults = await exchangeService.closeAllPositions();

    res.json({
      multiCoin: multiResults,
      singleBot: singleResult,
      exchange: exchangeResults
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Trades
// ============================================

router.get('/trades', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const trades = await database.getTrades(limit, offset);
    res.json(trades);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/trades/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.replace('-', '/');
    const limit = parseInt(req.query.limit) || 100;
    const trades = await database.getTradesBySymbol(symbol, limit);
    res.json(trades);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual trading
router.post('/trade/buy', async (req, res) => {
  try {
    const { symbol, amount, leverage, price } = req.body;
    if (!symbol || !amount) {
      return res.status(400).json({ error: 'Symbol and amount are required' });
    }

    if (leverage) {
      await exchangeService.setLeverage(symbol, leverage);
    }

    let order;
    if (price) {
      order = await exchangeService.createLimitOrder(symbol, 'buy', amount, price);
    } else {
      order = await exchangeService.createMarketOrder(symbol, 'buy', amount);
    }

    // Record trade
    await database.addTrade({
      symbol,
      side: 'buy',
      type: price ? 'limit' : 'market',
      amount: order.filled || amount,
      price: order.price,
      leverage: leverage || 1,
      status: 'closed',
      strategy: 'manual'
    });

    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/trade/sell', async (req, res) => {
  try {
    const { symbol, amount, leverage, price } = req.body;
    if (!symbol || !amount) {
      return res.status(400).json({ error: 'Symbol and amount are required' });
    }

    if (leverage) {
      await exchangeService.setLeverage(symbol, leverage);
    }

    let order;
    if (price) {
      order = await exchangeService.createLimitOrder(symbol, 'sell', amount, price);
    } else {
      order = await exchangeService.createMarketOrder(symbol, 'sell', amount);
    }

    // Record trade
    await database.addTrade({
      symbol,
      side: 'sell',
      type: price ? 'limit' : 'market',
      amount: order.filled || amount,
      price: order.price,
      leverage: leverage || 1,
      status: 'closed',
      strategy: 'manual'
    });

    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Settings & Configuration
// ============================================

router.get('/settings', async (req, res) => {
  try {
    const settings = await database.getSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/settings', async (req, res) => {
  try {
    await database.setSettings(req.body);
    res.json({ success: true, message: 'Settings updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/strategies', (req, res) => {
  res.json(tradingBot.getAvailableStrategies());
});

router.post('/strategy/change', async (req, res) => {
  try {
    const { strategy } = req.body;
    if (!strategy) {
      return res.status(400).json({ error: 'Strategy is required' });
    }
    const result = await tradingBot.updateConfig({ strategy });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/bot/config', async (req, res) => {
  try {
    const result = await tradingBot.updateConfig(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/risk-management', (req, res) => {
  res.json(tradingBot.getRiskSettings());
});

router.post('/risk-management', async (req, res) => {
  try {
    const result = await tradingBot.updateRiskSettings(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Position Sizing
// ============================================

router.get('/position-sizing', (req, res) => {
  res.json({
    settings: positionSizing.getSettings(),
    methods: positionSizing.getAvailableMethods()
  });
});

router.post('/position-sizing', async (req, res) => {
  try {
    const result = await positionSizing.updateSettings(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/position-sizing/calculate', async (req, res) => {
  try {
    const { balance, price, method, options } = req.body;
    if (!balance || !price) {
      return res.status(400).json({ error: 'Balance and price are required' });
    }
    const result = await positionSizing.calculatePositionSize(balance, price, { method, ...options });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Auto Optimization
// ============================================

router.get('/auto-optimization', (req, res) => {
  res.json(autoOptimizer.getSettings());
});

router.post('/auto-optimization', (req, res) => {
  try {
    const result = autoOptimizer.updateSettings(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/auto-optimization/recommendations', async (req, res) => {
  try {
    const result = await autoOptimizer.getRecommendations();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Analytics
// ============================================

router.get('/performance', async (req, res) => {
  try {
    const stats = await database.getPerformanceStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/analytics/daily-pnl', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const data = await database.getDailyPnl(days);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/analytics/cumulative-pnl', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const data = await database.getCumulativePnl(days);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/analytics/performance-by-coin', async (req, res) => {
  try {
    const data = await database.getPerformanceByCoin();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/analytics/performance-by-strategy', async (req, res) => {
  try {
    const data = await database.getPerformanceByStrategy();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Advanced Orders
// ============================================

router.get('/orders/advanced', (req, res) => {
  res.json(advancedOrdersService.getStatus());
});

router.post('/orders/oco', async (req, res) => {
  try {
    const result = await advancedOrdersService.createOCOOrder(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/orders/conditional', async (req, res) => {
  try {
    const result = await advancedOrdersService.createConditionalOrder(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/orders/trailing-stop', async (req, res) => {
  try {
    const result = await advancedOrdersService.createTrailingStopOrder(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/orders/advanced/:orderId', async (req, res) => {
  try {
    const result = await advancedOrdersService.cancelOrder(req.params.orderId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Backtesting
// ============================================

router.post('/backtest/run', async (req, res) => {
  try {
    const result = await backtestingEngine.runBacktest(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/backtest/optimize', async (req, res) => {
  try {
    const result = await backtestingEngine.optimize(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/backtest/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const history = await backtestingEngine.getHistory(limit);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/backtest/strategies', (req, res) => {
  res.json(backtestingEngine.getAvailableStrategies());
});

// ============================================
// Open Orders
// ============================================

router.get('/orders/open', async (req, res) => {
  try {
    const symbol = req.query.symbol?.replace('-', '/');
    const orders = await exchangeService.getOpenOrders(symbol);
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/orders/:orderId', async (req, res) => {
  try {
    const { symbol } = req.query;
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }
    const result = await exchangeService.cancelOrder(req.params.orderId, symbol.replace('-', '/'));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
