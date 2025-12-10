import exchangeService from './exchange.js';
import database from '../models/database.js';

/**
 * Advanced Orders Service
 * Handles OCO orders, conditional orders, and complex order types
 */
class AdvancedOrdersService {
  constructor() {
    this.activeOrders = new Map(); // orderId -> order details
    this.monitoringInterval = null;
    this.isMonitoring = false;
  }

  /**
   * Start monitoring orders
   */
  startMonitoring() {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    this.monitoringInterval = setInterval(() => this.checkOrders(), 5000); // Check every 5 seconds

    console.log('Advanced orders monitoring started');
  }

  /**
   * Stop monitoring orders
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.isMonitoring = false;
    console.log('Advanced orders monitoring stopped');
  }

  /**
   * Create an OCO (One-Cancels-Other) order
   * When one order fills, the other is automatically cancelled
   * @param {Object} params - Order parameters
   */
  async createOCOOrder(params) {
    const {
      symbol,
      side,
      amount,
      stopLossPrice,
      takeProfitPrice,
      leverage
    } = params;

    try {
      // Set leverage
      if (leverage) {
        await exchangeService.setLeverage(symbol, leverage);
      }

      // Create the OCO order entry
      const ocoOrder = {
        id: `oco_${Date.now()}`,
        type: 'OCO',
        symbol,
        side,
        amount,
        stopLossPrice,
        takeProfitPrice,
        leverage,
        status: 'active',
        createdAt: new Date(),
        stopLossTriggered: false,
        takeProfitTriggered: false
      };

      // Save to active orders
      this.activeOrders.set(ocoOrder.id, ocoOrder);

      // Save to database
      await database.addAdvancedOrder({
        type: 'OCO',
        symbol,
        side,
        amount,
        stop_loss: stopLossPrice,
        take_profit: takeProfitPrice,
        status: 'pending'
      });

      // Start monitoring if not already
      if (!this.isMonitoring) {
        this.startMonitoring();
      }

      console.log(`OCO order created: ${ocoOrder.id}`);

      return {
        success: true,
        order: ocoOrder
      };

    } catch (error) {
      console.error('Failed to create OCO order:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create a conditional order
   * Order is placed when a condition is met
   * @param {Object} params - Order parameters
   */
  async createConditionalOrder(params) {
    const {
      symbol,
      side,
      amount,
      triggerPrice,
      triggerCondition, // 'above' or 'below'
      orderType, // 'market' or 'limit'
      limitPrice,
      leverage
    } = params;

    try {
      const conditionalOrder = {
        id: `cond_${Date.now()}`,
        type: 'CONDITIONAL',
        symbol,
        side,
        amount,
        triggerPrice,
        triggerCondition,
        orderType,
        limitPrice,
        leverage,
        status: 'pending',
        createdAt: new Date(),
        triggered: false
      };

      // Save to active orders
      this.activeOrders.set(conditionalOrder.id, conditionalOrder);

      // Save to database
      await database.addAdvancedOrder({
        type: 'CONDITIONAL',
        symbol,
        side,
        amount,
        trigger_price: triggerPrice,
        limit_price: limitPrice,
        condition: triggerCondition,
        status: 'pending'
      });

      // Start monitoring if not already
      if (!this.isMonitoring) {
        this.startMonitoring();
      }

      console.log(`Conditional order created: ${conditionalOrder.id}`);

      return {
        success: true,
        order: conditionalOrder
      };

    } catch (error) {
      console.error('Failed to create conditional order:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create a trailing stop order
   * @param {Object} params - Order parameters
   */
  async createTrailingStopOrder(params) {
    const {
      symbol,
      side, // 'long' or 'short' (position side)
      amount,
      trailingPercent,
      activationPrice // Optional: only activate after price reaches this level
    } = params;

    try {
      const ticker = await exchangeService.getTicker(symbol);
      const currentPrice = ticker.last;

      // Calculate initial stop price
      let stopPrice;
      if (side === 'long') {
        stopPrice = currentPrice * (1 - trailingPercent / 100);
      } else {
        stopPrice = currentPrice * (1 + trailingPercent / 100);
      }

      const trailingOrder = {
        id: `trail_${Date.now()}`,
        type: 'TRAILING_STOP',
        symbol,
        side,
        amount,
        trailingPercent,
        activationPrice,
        currentStopPrice: stopPrice,
        highestPrice: side === 'long' ? currentPrice : null,
        lowestPrice: side === 'short' ? currentPrice : null,
        status: activationPrice ? 'waiting_activation' : 'active',
        createdAt: new Date()
      };

      // Save to active orders
      this.activeOrders.set(trailingOrder.id, trailingOrder);

      // Save to database
      await database.addAdvancedOrder({
        type: 'TRAILING_STOP',
        symbol,
        side: side === 'long' ? 'sell' : 'buy',
        amount,
        trigger_price: stopPrice,
        condition: `trailing_${trailingPercent}%`,
        status: 'pending'
      });

      // Start monitoring if not already
      if (!this.isMonitoring) {
        this.startMonitoring();
      }

      console.log(`Trailing stop order created: ${trailingOrder.id}`);

      return {
        success: true,
        order: trailingOrder
      };

    } catch (error) {
      console.error('Failed to create trailing stop order:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check all active orders
   */
  async checkOrders() {
    for (const [orderId, order] of this.activeOrders) {
      try {
        switch (order.type) {
          case 'OCO':
            await this.checkOCOOrder(order);
            break;
          case 'CONDITIONAL':
            await this.checkConditionalOrder(order);
            break;
          case 'TRAILING_STOP':
            await this.checkTrailingStopOrder(order);
            break;
        }
      } catch (error) {
        console.error(`Error checking order ${orderId}:`, error.message);
      }
    }
  }

  /**
   * Check OCO order conditions
   */
  async checkOCOOrder(order) {
    if (order.status !== 'active') return;

    try {
      const ticker = await exchangeService.getTicker(order.symbol);
      const currentPrice = ticker.last;

      // Determine position side based on order side
      const isLong = order.side === 'sell'; // Selling to close long
      const isShort = order.side === 'buy'; // Buying to close short

      // Check stop loss
      if (isLong && currentPrice <= order.stopLossPrice) {
        await this.executeOCO(order, 'stop_loss', currentPrice);
        return;
      }
      if (isShort && currentPrice >= order.stopLossPrice) {
        await this.executeOCO(order, 'stop_loss', currentPrice);
        return;
      }

      // Check take profit
      if (isLong && currentPrice >= order.takeProfitPrice) {
        await this.executeOCO(order, 'take_profit', currentPrice);
        return;
      }
      if (isShort && currentPrice <= order.takeProfitPrice) {
        await this.executeOCO(order, 'take_profit', currentPrice);
        return;
      }

    } catch (error) {
      console.error(`Error checking OCO order ${order.id}:`, error.message);
    }
  }

  /**
   * Execute OCO order
   */
  async executeOCO(order, trigger, currentPrice) {
    try {
      console.log(`OCO triggered: ${trigger} at ${currentPrice}`);

      // Execute the order
      const result = await exchangeService.createMarketOrder(
        order.symbol,
        order.side,
        order.amount,
        { reduceOnly: true }
      );

      // Update order status
      order.status = 'executed';
      order[trigger === 'stop_loss' ? 'stopLossTriggered' : 'takeProfitTriggered'] = true;
      order.executedAt = new Date();
      order.executedPrice = result.price;

      // Update database
      await database.updateAdvancedOrder(order.id, {
        status: 'executed',
        executed_at: new Date().toISOString()
      });

      // Remove from active orders
      this.activeOrders.delete(order.id);

      console.log(`OCO order ${order.id} executed: ${trigger} at ${result.price}`);

    } catch (error) {
      console.error(`Failed to execute OCO order ${order.id}:`, error.message);
    }
  }

  /**
   * Check conditional order conditions
   */
  async checkConditionalOrder(order) {
    if (order.status !== 'pending') return;

    try {
      const ticker = await exchangeService.getTicker(order.symbol);
      const currentPrice = ticker.last;

      let triggered = false;

      if (order.triggerCondition === 'above' && currentPrice >= order.triggerPrice) {
        triggered = true;
      } else if (order.triggerCondition === 'below' && currentPrice <= order.triggerPrice) {
        triggered = true;
      }

      if (triggered) {
        await this.executeConditional(order, currentPrice);
      }

    } catch (error) {
      console.error(`Error checking conditional order ${order.id}:`, error.message);
    }
  }

  /**
   * Execute conditional order
   */
  async executeConditional(order, currentPrice) {
    try {
      console.log(`Conditional order triggered at ${currentPrice}`);

      // Set leverage if specified
      if (order.leverage) {
        await exchangeService.setLeverage(order.symbol, order.leverage);
      }

      // Execute the order
      let result;
      if (order.orderType === 'market') {
        result = await exchangeService.createMarketOrder(
          order.symbol,
          order.side,
          order.amount
        );
      } else {
        result = await exchangeService.createLimitOrder(
          order.symbol,
          order.side,
          order.amount,
          order.limitPrice
        );
      }

      // Update order status
      order.status = 'executed';
      order.triggered = true;
      order.executedAt = new Date();
      order.executedPrice = result.price;

      // Update database
      await database.updateAdvancedOrder(order.id, {
        status: 'executed',
        executed_at: new Date().toISOString()
      });

      // Remove from active orders
      this.activeOrders.delete(order.id);

      console.log(`Conditional order ${order.id} executed at ${result.price}`);

    } catch (error) {
      console.error(`Failed to execute conditional order ${order.id}:`, error.message);
    }
  }

  /**
   * Check trailing stop order conditions
   */
  async checkTrailingStopOrder(order) {
    if (order.status !== 'active' && order.status !== 'waiting_activation') return;

    try {
      const ticker = await exchangeService.getTicker(order.symbol);
      const currentPrice = ticker.last;

      // Check activation
      if (order.status === 'waiting_activation') {
        if (order.side === 'long' && currentPrice >= order.activationPrice) {
          order.status = 'active';
          order.highestPrice = currentPrice;
          console.log(`Trailing stop activated at ${currentPrice}`);
        } else if (order.side === 'short' && currentPrice <= order.activationPrice) {
          order.status = 'active';
          order.lowestPrice = currentPrice;
          console.log(`Trailing stop activated at ${currentPrice}`);
        }
        return;
      }

      // Update trailing stop for long position
      if (order.side === 'long') {
        if (currentPrice > order.highestPrice) {
          order.highestPrice = currentPrice;
          order.currentStopPrice = currentPrice * (1 - order.trailingPercent / 100);
        }

        // Check if stop triggered
        if (currentPrice <= order.currentStopPrice) {
          await this.executeTrailingStop(order, currentPrice);
        }
      }

      // Update trailing stop for short position
      if (order.side === 'short') {
        if (currentPrice < order.lowestPrice) {
          order.lowestPrice = currentPrice;
          order.currentStopPrice = currentPrice * (1 + order.trailingPercent / 100);
        }

        // Check if stop triggered
        if (currentPrice >= order.currentStopPrice) {
          await this.executeTrailingStop(order, currentPrice);
        }
      }

    } catch (error) {
      console.error(`Error checking trailing stop ${order.id}:`, error.message);
    }
  }

  /**
   * Execute trailing stop order
   */
  async executeTrailingStop(order, currentPrice) {
    try {
      console.log(`Trailing stop triggered at ${currentPrice}`);

      const closeSide = order.side === 'long' ? 'sell' : 'buy';

      const result = await exchangeService.createMarketOrder(
        order.symbol,
        closeSide,
        order.amount,
        { reduceOnly: true }
      );

      // Update order status
      order.status = 'executed';
      order.executedAt = new Date();
      order.executedPrice = result.price;

      // Update database
      await database.updateAdvancedOrder(order.id, {
        status: 'executed',
        executed_at: new Date().toISOString()
      });

      // Remove from active orders
      this.activeOrders.delete(order.id);

      console.log(`Trailing stop ${order.id} executed at ${result.price}`);

    } catch (error) {
      console.error(`Failed to execute trailing stop ${order.id}:`, error.message);
    }
  }

  /**
   * Cancel an advanced order
   */
  async cancelOrder(orderId) {
    const order = this.activeOrders.get(orderId);

    if (!order) {
      // Check database
      const dbOrders = await database.getAdvancedOrders('pending');
      const dbOrder = dbOrders.find(o => o.id.toString() === orderId);

      if (dbOrder) {
        await database.cancelAdvancedOrder(dbOrder.id);
        return { success: true, message: `Order ${orderId} cancelled` };
      }

      return { success: false, message: `Order ${orderId} not found` };
    }

    order.status = 'cancelled';
    order.cancelledAt = new Date();

    this.activeOrders.delete(orderId);

    // Update database
    await database.cancelAdvancedOrder(orderId);

    console.log(`Order ${orderId} cancelled`);

    return { success: true, message: `Order ${orderId} cancelled` };
  }

  /**
   * Get all active orders
   */
  getActiveOrders() {
    return Array.from(this.activeOrders.values());
  }

  /**
   * Get order by ID
   */
  getOrder(orderId) {
    return this.activeOrders.get(orderId);
  }

  /**
   * Get orders from database
   */
  async getOrdersFromDb(status = 'pending') {
    return database.getAdvancedOrders(status);
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      isMonitoring: this.isMonitoring,
      activeOrdersCount: this.activeOrders.size,
      activeOrders: this.getActiveOrders()
    };
  }
}

// Singleton instance
const advancedOrdersService = new AdvancedOrdersService();

export default advancedOrdersService;
