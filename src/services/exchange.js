import ccxt from 'ccxt';

/**
 * Exchange Service - Gate.io CCXT Integration
 * Handles all exchange API interactions for futures trading
 */
class ExchangeService {
  constructor() {
    this.exchange = null;
    this.initialized = false;
    this.useTestnet = process.env.USE_TESTNET === 'true';
  }

  /**
   * Initialize the exchange connection
   */
  async initialize() {
    try {
      const exchangeId = process.env.EXCHANGE || 'gateio';

      this.exchange = new ccxt[exchangeId]({
        apiKey: process.env.API_KEY,
        secret: process.env.API_SECRET,
        enableRateLimit: true,
        options: {
          defaultType: 'swap', // Use perpetual futures
          defaultSettle: 'usdt' // USDT-settled futures
        }
      });

      // Enable testnet if configured
      if (this.useTestnet) {
        this.exchange.setSandboxMode(true);
        console.log('Using Gate.io Testnet');
      }

      // Load markets
      await this.exchange.loadMarkets();
      this.initialized = true;

      console.log(`Exchange ${exchangeId} initialized successfully`);
      console.log(`Available markets: ${Object.keys(this.exchange.markets).length}`);

      return true;
    } catch (error) {
      console.error('Failed to initialize exchange:', error.message);
      throw error;
    }
  }

  /**
   * Ensure exchange is initialized
   */
  ensureInitialized() {
    if (!this.initialized) {
      throw new Error('Exchange not initialized. Call initialize() first.');
    }
  }

  /**
   * Format symbol for Gate.io futures (add :USDT suffix)
   * @param {string} symbol - Trading pair (e.g., BTC/USDT)
   * @returns {string} Formatted symbol (e.g., BTC/USDT:USDT)
   */
  formatSymbol(symbol) {
    if (!symbol.includes(':')) {
      return `${symbol}:USDT`;
    }
    return symbol;
  }

  /**
   * Get account balance
   * @returns {Object} Balance information
   */
  async getBalance() {
    this.ensureInitialized();

    try {
      const balance = await this.exchange.fetchBalance({ type: 'swap' });

      return {
        total: balance.total,
        free: balance.free,
        used: balance.used,
        USDT: {
          total: balance.total?.USDT || 0,
          free: balance.free?.USDT || 0,
          used: balance.used?.USDT || 0
        }
      };
    } catch (error) {
      console.error('Failed to fetch balance:', error.message);
      throw error;
    }
  }

  /**
   * Get current ticker/price for a symbol
   * @param {string} symbol - Trading pair
   * @returns {Object} Ticker data
   */
  async getTicker(symbol) {
    this.ensureInitialized();

    try {
      const formattedSymbol = this.formatSymbol(symbol);
      const ticker = await this.exchange.fetchTicker(formattedSymbol);

      return {
        symbol: ticker.symbol,
        last: ticker.last,
        bid: ticker.bid,
        ask: ticker.ask,
        high: ticker.high,
        low: ticker.low,
        volume: ticker.baseVolume,
        quoteVolume: ticker.quoteVolume,
        change: ticker.change,
        percentage: ticker.percentage,
        timestamp: ticker.timestamp
      };
    } catch (error) {
      console.error(`Failed to fetch ticker for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get OHLCV candlestick data
   * @param {string} symbol - Trading pair
   * @param {string} timeframe - Candle timeframe (1m, 5m, 15m, 1h, etc.)
   * @param {number} limit - Number of candles to fetch
   * @returns {Array} OHLCV data [[timestamp, open, high, low, close, volume], ...]
   */
  async getOHLCV(symbol, timeframe = '5m', limit = 100) {
    this.ensureInitialized();

    try {
      const formattedSymbol = this.formatSymbol(symbol);
      const ohlcv = await this.exchange.fetchOHLCV(formattedSymbol, timeframe, undefined, limit);

      return ohlcv;
    } catch (error) {
      console.error(`Failed to fetch OHLCV for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get open positions
   * @param {string} symbol - Optional symbol filter
   * @returns {Array} List of positions
   */
  async getPositions(symbol = null) {
    this.ensureInitialized();

    try {
      let symbols = undefined;
      if (symbol) {
        symbols = [this.formatSymbol(symbol)];
      }

      const positions = await this.exchange.fetchPositions(symbols);

      return positions
        .filter(p => parseFloat(p.contracts) !== 0)
        .map(p => ({
          symbol: p.symbol,
          side: p.side,
          contracts: parseFloat(p.contracts),
          contractSize: parseFloat(p.contractSize || 1),
          entryPrice: parseFloat(p.entryPrice),
          markPrice: parseFloat(p.markPrice),
          liquidationPrice: parseFloat(p.liquidationPrice),
          leverage: parseInt(p.leverage),
          unrealizedPnl: parseFloat(p.unrealizedPnl),
          percentage: parseFloat(p.percentage),
          marginType: p.marginType,
          notional: parseFloat(p.notional)
        }));
    } catch (error) {
      console.error('Failed to fetch positions:', error.message);
      throw error;
    }
  }

  /**
   * Set leverage for a symbol
   * @param {string} symbol - Trading pair
   * @param {number} leverage - Leverage value (1-75)
   * @returns {Object} Leverage setting result
   */
  async setLeverage(symbol, leverage) {
    this.ensureInitialized();

    try {
      const formattedSymbol = this.formatSymbol(symbol);
      const result = await this.exchange.setLeverage(leverage, formattedSymbol);

      console.log(`Leverage set to ${leverage}x for ${formattedSymbol}`);
      return result;
    } catch (error) {
      // Some exchanges don't require setting leverage beforehand
      console.warn(`Failed to set leverage for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Set margin mode (cross or isolated)
   * @param {string} symbol - Trading pair
   * @param {string} marginMode - 'cross' or 'isolated'
   */
  async setMarginMode(symbol, marginMode = 'cross') {
    this.ensureInitialized();

    try {
      const formattedSymbol = this.formatSymbol(symbol);
      await this.exchange.setMarginMode(marginMode, formattedSymbol);
      console.log(`Margin mode set to ${marginMode} for ${formattedSymbol}`);
    } catch (error) {
      console.warn(`Failed to set margin mode for ${symbol}:`, error.message);
    }
  }

  /**
   * Create a market order
   * @param {string} symbol - Trading pair
   * @param {string} side - 'buy' or 'sell'
   * @param {number} amount - Order amount in contracts
   * @param {Object} params - Additional parameters
   * @returns {Object} Order result
   */
  async createMarketOrder(symbol, side, amount, params = {}) {
    this.ensureInitialized();

    try {
      const formattedSymbol = this.formatSymbol(symbol);

      // Set leverage before order
      if (params.leverage) {
        await this.setLeverage(symbol, params.leverage);
      }

      const order = await this.exchange.createMarketOrder(
        formattedSymbol,
        side,
        amount,
        undefined,
        params
      );

      console.log(`Market ${side} order executed: ${amount} ${formattedSymbol} at ${order.average || order.price}`);

      return {
        id: order.id,
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        amount: order.amount,
        filled: order.filled,
        remaining: order.remaining,
        price: order.average || order.price,
        cost: order.cost,
        fee: order.fee,
        status: order.status,
        timestamp: order.timestamp
      };
    } catch (error) {
      console.error(`Failed to create market order for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Create a limit order
   * @param {string} symbol - Trading pair
   * @param {string} side - 'buy' or 'sell'
   * @param {number} amount - Order amount in contracts
   * @param {number} price - Limit price
   * @param {Object} params - Additional parameters
   * @returns {Object} Order result
   */
  async createLimitOrder(symbol, side, amount, price, params = {}) {
    this.ensureInitialized();

    try {
      const formattedSymbol = this.formatSymbol(symbol);

      // Set leverage before order
      if (params.leverage) {
        await this.setLeverage(symbol, params.leverage);
      }

      const order = await this.exchange.createLimitOrder(
        formattedSymbol,
        side,
        amount,
        price,
        params
      );

      console.log(`Limit ${side} order placed: ${amount} ${formattedSymbol} at ${price}`);

      return {
        id: order.id,
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        amount: order.amount,
        price: order.price,
        status: order.status,
        timestamp: order.timestamp
      };
    } catch (error) {
      console.error(`Failed to create limit order for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Create a stop-loss order
   * @param {string} symbol - Trading pair
   * @param {string} side - 'buy' or 'sell'
   * @param {number} amount - Order amount
   * @param {number} stopPrice - Trigger price
   * @param {Object} params - Additional parameters
   */
  async createStopOrder(symbol, side, amount, stopPrice, params = {}) {
    this.ensureInitialized();

    try {
      const formattedSymbol = this.formatSymbol(symbol);

      const order = await this.exchange.createOrder(
        formattedSymbol,
        'stop_market',
        side,
        amount,
        undefined,
        {
          stopPrice,
          reduceOnly: true,
          ...params
        }
      );

      console.log(`Stop ${side} order placed: ${amount} ${formattedSymbol} at ${stopPrice}`);

      return {
        id: order.id,
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        amount: order.amount,
        stopPrice,
        status: order.status,
        timestamp: order.timestamp
      };
    } catch (error) {
      console.error(`Failed to create stop order for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Create a take-profit order
   * @param {string} symbol - Trading pair
   * @param {string} side - 'buy' or 'sell'
   * @param {number} amount - Order amount
   * @param {number} takeProfitPrice - Trigger price
   * @param {Object} params - Additional parameters
   */
  async createTakeProfitOrder(symbol, side, amount, takeProfitPrice, params = {}) {
    this.ensureInitialized();

    try {
      const formattedSymbol = this.formatSymbol(symbol);

      const order = await this.exchange.createOrder(
        formattedSymbol,
        'take_profit_market',
        side,
        amount,
        undefined,
        {
          stopPrice: takeProfitPrice,
          reduceOnly: true,
          ...params
        }
      );

      console.log(`Take-profit ${side} order placed: ${amount} ${formattedSymbol} at ${takeProfitPrice}`);

      return {
        id: order.id,
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        amount: order.amount,
        stopPrice: takeProfitPrice,
        status: order.status,
        timestamp: order.timestamp
      };
    } catch (error) {
      console.error(`Failed to create take-profit order for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Close a position
   * @param {string} symbol - Trading pair
   * @param {string} side - Position side to close ('long' or 'short')
   * @param {number} amount - Amount to close (optional, closes all if not specified)
   * @returns {Object} Order result
   */
  async closePosition(symbol, side, amount = null) {
    this.ensureInitialized();

    try {
      const positions = await this.getPositions(symbol);
      const position = positions.find(p => {
        const posSymbol = p.symbol.replace(':USDT', '').replace('/', '');
        const searchSymbol = symbol.replace(':USDT', '').replace('/', '');
        return posSymbol === searchSymbol;
      });

      if (!position) {
        throw new Error(`No open position found for ${symbol}`);
      }

      const closeAmount = amount || position.contracts;
      const closeSide = position.side === 'long' ? 'sell' : 'buy';

      const order = await this.createMarketOrder(symbol, closeSide, closeAmount, {
        reduceOnly: true
      });

      console.log(`Position closed: ${closeAmount} ${symbol}`);

      return order;
    } catch (error) {
      console.error(`Failed to close position for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Close all positions
   * @returns {Array} Results of all close operations
   */
  async closeAllPositions() {
    this.ensureInitialized();

    try {
      const positions = await this.getPositions();
      const results = [];

      for (const position of positions) {
        try {
          const baseSymbol = position.symbol.split(':')[0];
          const result = await this.closePosition(baseSymbol, position.side);
          results.push({ symbol: position.symbol, success: true, result });
        } catch (error) {
          results.push({ symbol: position.symbol, success: false, error: error.message });
        }
      }

      return results;
    } catch (error) {
      console.error('Failed to close all positions:', error.message);
      throw error;
    }
  }

  /**
   * Cancel an order
   * @param {string} orderId - Order ID
   * @param {string} symbol - Trading pair
   * @returns {Object} Cancellation result
   */
  async cancelOrder(orderId, symbol) {
    this.ensureInitialized();

    try {
      const formattedSymbol = this.formatSymbol(symbol);
      const result = await this.exchange.cancelOrder(orderId, formattedSymbol);

      console.log(`Order ${orderId} cancelled for ${formattedSymbol}`);
      return result;
    } catch (error) {
      console.error(`Failed to cancel order ${orderId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get open orders
   * @param {string} symbol - Optional symbol filter
   * @returns {Array} List of open orders
   */
  async getOpenOrders(symbol = null) {
    this.ensureInitialized();

    try {
      const formattedSymbol = symbol ? this.formatSymbol(symbol) : undefined;
      const orders = await this.exchange.fetchOpenOrders(formattedSymbol);

      return orders.map(o => ({
        id: o.id,
        symbol: o.symbol,
        side: o.side,
        type: o.type,
        amount: o.amount,
        price: o.price,
        filled: o.filled,
        remaining: o.remaining,
        status: o.status,
        timestamp: o.timestamp
      }));
    } catch (error) {
      console.error('Failed to fetch open orders:', error.message);
      throw error;
    }
  }

  /**
   * Get order history
   * @param {string} symbol - Trading pair
   * @param {number} limit - Number of orders to fetch
   * @returns {Array} List of orders
   */
  async getOrderHistory(symbol, limit = 50) {
    this.ensureInitialized();

    try {
      const formattedSymbol = this.formatSymbol(symbol);
      const orders = await this.exchange.fetchClosedOrders(formattedSymbol, undefined, limit);

      return orders.map(o => ({
        id: o.id,
        symbol: o.symbol,
        side: o.side,
        type: o.type,
        amount: o.amount,
        price: o.price || o.average,
        filled: o.filled,
        cost: o.cost,
        fee: o.fee,
        status: o.status,
        timestamp: o.timestamp
      }));
    } catch (error) {
      console.error(`Failed to fetch order history for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get available trading pairs
   * @returns {Array} List of available futures symbols
   */
  getAvailableSymbols() {
    this.ensureInitialized();

    const symbols = Object.keys(this.exchange.markets)
      .filter(s => s.includes(':USDT'))
      .map(s => s.replace(':USDT', ''))
      .sort();

    return symbols;
  }

  /**
   * Calculate position size based on USD amount
   * @param {string} symbol - Trading pair
   * @param {number} usdAmount - Amount in USD
   * @param {number} leverage - Leverage to use
   * @returns {Object} Position size calculation
   */
  async calculatePositionSize(symbol, usdAmount, leverage = 1) {
    this.ensureInitialized();

    try {
      const ticker = await this.getTicker(symbol);
      const market = this.exchange.market(this.formatSymbol(symbol));

      const contractValue = ticker.last * (market.contractSize || 1);
      const contracts = (usdAmount * leverage) / contractValue;
      const adjustedContracts = Math.floor(contracts * 1000) / 1000; // Round down to 3 decimals

      return {
        symbol,
        price: ticker.last,
        usdAmount,
        leverage,
        contracts: adjustedContracts,
        contractSize: market.contractSize || 1,
        notionalValue: adjustedContracts * contractValue,
        margin: (adjustedContracts * contractValue) / leverage
      };
    } catch (error) {
      console.error(`Failed to calculate position size for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get exchange info and status
   */
  getExchangeInfo() {
    return {
      name: this.exchange?.name,
      id: this.exchange?.id,
      testnet: this.useTestnet,
      initialized: this.initialized,
      rateLimit: this.exchange?.rateLimit,
      has: {
        fetchBalance: this.exchange?.has?.fetchBalance,
        fetchTicker: this.exchange?.has?.fetchTicker,
        fetchOHLCV: this.exchange?.has?.fetchOHLCV,
        fetchPositions: this.exchange?.has?.fetchPositions,
        createOrder: this.exchange?.has?.createOrder,
        cancelOrder: this.exchange?.has?.cancelOrder
      }
    };
  }
}

// Singleton instance
const exchangeService = new ExchangeService();

export default exchangeService;
