import WebSocket from 'ws';
import crypto from 'crypto';
import { EventEmitter } from 'events';

/**
 * Gate.io Futures WebSocket Client
 * Real-time data streaming for USDT-margined perpetual futures
 */
export class GateFuturesWebSocket extends EventEmitter {
    constructor(apiKey = null, apiSecret = null, options = {}) {
        super();
        this.apiKey = apiKey || process.env.GATE_API_KEY;
        this.apiSecret = apiSecret || process.env.GATE_API_SECRET;
        this.wsUrl = options.testnet
            ? 'wss://fx-ws-testnet.gateio.ws/v4/ws/usdt'
            : 'wss://fx-ws.gateio.ws/v4/ws/usdt';

        this.ws = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
        this.reconnectInterval = options.reconnectInterval || 5000;
        this.pingInterval = null;
        this.subscriptions = new Map();

        // Track latest prices for each contract
        this.prices = new Map();
    }

    /**
     * Generate authentication signature
     */
    generateAuthSignature(channel, event, timestamp) {
        const message = `channel=${channel}&event=${event}&time=${timestamp}`;
        return crypto.createHmac('sha512', this.apiSecret).update(message).digest('hex');
    }

    /**
     * Connect to WebSocket
     */
    async connect() {
        return new Promise((resolve, reject) => {
            if (this.isConnected) {
                resolve();
                return;
            }

            this.ws = new WebSocket(this.wsUrl);

            this.ws.on('open', () => {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                console.log('WebSocket connected to Gate.io Futures');

                // Start ping interval
                this.startPing();

                // Resubscribe to previous channels
                this.resubscribe();

                this.emit('connected');
                resolve();
            });

            this.ws.on('message', (data) => {
                this.handleMessage(data);
            });

            this.ws.on('error', (error) => {
                console.error('WebSocket error:', error.message);
                this.emit('error', error);
            });

            this.ws.on('close', () => {
                this.isConnected = false;
                this.stopPing();
                console.log('WebSocket disconnected');
                this.emit('disconnected');

                // Attempt reconnection
                this.attemptReconnect();
            });

            // Timeout for initial connection
            setTimeout(() => {
                if (!this.isConnected) {
                    reject(new Error('Connection timeout'));
                }
            }, 10000);
        });
    }

    /**
     * Handle incoming messages
     */
    handleMessage(data) {
        try {
            const message = JSON.parse(data.toString());

            // Handle ping/pong
            if (message.channel === 'futures.ping') {
                return;
            }

            // Handle subscription responses
            if (message.event === 'subscribe' || message.event === 'unsubscribe') {
                this.emit('subscription', message);
                return;
            }

            // Handle data updates
            if (message.event === 'update' && message.result) {
                this.processUpdate(message.channel, message.result);
            }
        } catch (error) {
            console.error('Failed to parse message:', error.message);
        }
    }

    /**
     * Process channel updates
     */
    processUpdate(channel, data) {
        // Ticker updates
        if (channel === 'futures.tickers') {
            for (const ticker of Array.isArray(data) ? data : [data]) {
                const contract = ticker.contract;
                const price = parseFloat(ticker.last);

                this.prices.set(contract, price);

                this.emit('ticker', {
                    contract,
                    price,
                    data: ticker
                });
            }
        }

        // Trade updates
        else if (channel === 'futures.trades') {
            for (const trade of Array.isArray(data) ? data : [data]) {
                this.emit('trade', {
                    contract: trade.contract,
                    price: parseFloat(trade.price),
                    size: parseInt(trade.size),
                    side: trade.size > 0 ? 'buy' : 'sell',
                    timestamp: trade.create_time,
                    data: trade
                });
            }
        }

        // OrderBook updates
        else if (channel === 'futures.order_book') {
            this.emit('orderbook', {
                contract: data.contract,
                asks: data.asks?.map(([price, size]) => ({ price: parseFloat(price), size: parseInt(size) })),
                bids: data.bids?.map(([price, size]) => ({ price: parseFloat(price), size: parseInt(size) })),
                data
            });
        }

        // Candlestick updates
        else if (channel === 'futures.candlesticks') {
            for (const candle of Array.isArray(data) ? data : [data]) {
                this.emit('candlestick', {
                    contract: candle.n.split('_').slice(1).join('_'),
                    interval: candle.n.split('_')[0],
                    timestamp: candle.t,
                    open: parseFloat(candle.o),
                    high: parseFloat(candle.h),
                    low: parseFloat(candle.l),
                    close: parseFloat(candle.c),
                    volume: parseInt(candle.v),
                    data: candle
                });
            }
        }

        // Position updates (authenticated)
        else if (channel === 'futures.positions') {
            for (const position of Array.isArray(data) ? data : [data]) {
                this.emit('position', {
                    contract: position.contract,
                    size: parseInt(position.size),
                    entryPrice: parseFloat(position.entry_price),
                    markPrice: parseFloat(position.mark_price),
                    leverage: parseInt(position.leverage),
                    unrealizedPnl: parseFloat(position.unrealised_pnl),
                    data: position
                });
            }
        }

        // Order updates (authenticated)
        else if (channel === 'futures.orders') {
            for (const order of Array.isArray(data) ? data : [data]) {
                this.emit('order', {
                    id: order.id,
                    contract: order.contract,
                    size: parseInt(order.size),
                    price: parseFloat(order.price),
                    status: order.status,
                    filledSize: parseInt(order.left) ? parseInt(order.size) - parseInt(order.left) : parseInt(order.size),
                    data: order
                });
            }
        }

        // User trades (authenticated)
        else if (channel === 'futures.usertrades') {
            for (const trade of Array.isArray(data) ? data : [data]) {
                this.emit('usertrade', {
                    id: trade.id,
                    contract: trade.contract,
                    orderId: trade.order_id,
                    size: parseInt(trade.size),
                    price: parseFloat(trade.price),
                    role: trade.role,
                    data: trade
                });
            }
        }

        // Generic update event
        this.emit('update', { channel, data });
    }

    /**
     * Send a message to WebSocket
     */
    send(message) {
        if (!this.isConnected || !this.ws) {
            console.error('WebSocket not connected');
            return false;
        }

        this.ws.send(JSON.stringify(message));
        return true;
    }

    /**
     * Subscribe to a channel
     */
    subscribe(channel, payload = [], auth = false) {
        const timestamp = Math.floor(Date.now() / 1000);

        const message = {
            time: timestamp,
            channel,
            event: 'subscribe',
            payload
        };

        if (auth && this.apiKey && this.apiSecret) {
            message.auth = {
                method: 'api_key',
                KEY: this.apiKey,
                SIGN: this.generateAuthSignature(channel, 'subscribe', timestamp)
            };
        }

        // Track subscription
        const key = `${channel}:${JSON.stringify(payload)}`;
        this.subscriptions.set(key, { channel, payload, auth });

        return this.send(message);
    }

    /**
     * Unsubscribe from a channel
     */
    unsubscribe(channel, payload = []) {
        const timestamp = Math.floor(Date.now() / 1000);

        const message = {
            time: timestamp,
            channel,
            event: 'unsubscribe',
            payload
        };

        // Remove subscription tracking
        const key = `${channel}:${JSON.stringify(payload)}`;
        this.subscriptions.delete(key);

        return this.send(message);
    }

    /**
     * Resubscribe to all previous channels after reconnection
     */
    resubscribe() {
        for (const { channel, payload, auth } of this.subscriptions.values()) {
            this.subscribe(channel, payload, auth);
        }
    }

    // ==================== Public Channels ====================

    /**
     * Subscribe to ticker updates
     */
    subscribeTickers(contracts) {
        const payload = contracts.map(c => this.formatContract(c));
        return this.subscribe('futures.tickers', payload);
    }

    /**
     * Unsubscribe from ticker updates
     */
    unsubscribeTickers(contracts) {
        const payload = contracts.map(c => this.formatContract(c));
        return this.unsubscribe('futures.tickers', payload);
    }

    /**
     * Subscribe to trade updates
     */
    subscribeTrades(contracts) {
        const payload = contracts.map(c => this.formatContract(c));
        return this.subscribe('futures.trades', payload);
    }

    /**
     * Subscribe to orderbook updates
     * @param contracts - List of contracts
     * @param interval - Update interval: '100ms', '1000ms'
     * @param limit - Depth limit: 5, 10, 20, 50, 100
     */
    subscribeOrderBook(contracts, interval = '100ms', limit = 20) {
        const payload = contracts.map(c => `${this.formatContract(c)},${interval},${limit}`);
        return this.subscribe('futures.order_book', payload);
    }

    /**
     * Subscribe to candlestick updates
     * @param contracts - List of contracts
     * @param interval - Candlestick interval: '10s', '1m', '5m', '15m', '30m', '1h', '4h', '8h', '1d', '7d'
     */
    subscribeCandlesticks(contracts, interval = '1m') {
        const payload = contracts.map(c => `${interval}_${this.formatContract(c)}`);
        return this.subscribe('futures.candlesticks', payload);
    }

    // ==================== Private Channels (Authenticated) ====================

    /**
     * Subscribe to position updates
     */
    subscribePositions(userId) {
        return this.subscribe('futures.positions', [userId.toString()], true);
    }

    /**
     * Subscribe to order updates
     */
    subscribeOrders(userId) {
        return this.subscribe('futures.orders', [userId.toString()], true);
    }

    /**
     * Subscribe to user trade updates
     */
    subscribeUserTrades(userId) {
        return this.subscribe('futures.usertrades', [userId.toString()], true);
    }

    /**
     * Subscribe to balance updates
     */
    subscribeBalances(userId) {
        return this.subscribe('futures.balances', [userId.toString()], true);
    }

    // ==================== Utility Methods ====================

    /**
     * Format contract name
     */
    formatContract(symbol) {
        // Convert BTC/USDT or BTCUSDT to BTC_USDT
        return symbol.replace('/', '_').replace(/([A-Z]+)(USDT)$/i, '$1_$2').toUpperCase();
    }

    /**
     * Get current price for a contract
     */
    getPrice(contract) {
        return this.prices.get(this.formatContract(contract));
    }

    /**
     * Get all current prices
     */
    getAllPrices() {
        return Object.fromEntries(this.prices);
    }

    /**
     * Start ping interval to keep connection alive
     */
    startPing() {
        this.pingInterval = setInterval(() => {
            if (this.isConnected) {
                this.send({
                    time: Math.floor(Date.now() / 1000),
                    channel: 'futures.ping'
                });
            }
        }, 20000); // Ping every 20 seconds
    }

    /**
     * Stop ping interval
     */
    stopPing() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    /**
     * Attempt to reconnect
     */
    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached');
            this.emit('reconnect_failed');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1);

        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

        setTimeout(() => {
            this.connect().catch(console.error);
        }, delay);
    }

    /**
     * Disconnect from WebSocket
     */
    disconnect() {
        this.stopPing();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
        this.subscriptions.clear();
        this.prices.clear();
    }

    /**
     * Check if connected
     */
    connected() {
        return this.isConnected;
    }
}

export default GateFuturesWebSocket;
