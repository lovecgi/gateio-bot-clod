import crypto from 'crypto';

/**
 * Gate.io Futures REST API Client
 * Direct API implementation for USDT-margined perpetual futures
 */
export class GateFuturesREST {
    constructor(apiKey = null, apiSecret = null, options = {}) {
        this.apiKey = apiKey || process.env.GATE_API_KEY;
        this.apiSecret = apiSecret || process.env.GATE_API_SECRET;
        this.baseUrl = options.testnet
            ? 'https://fx-api-testnet.gateio.ws/api/v4'
            : 'https://api.gateio.ws/api/v4';
        this.settle = options.settle || 'usdt';
    }

    /**
     * Generate signature for authenticated requests
     */
    generateSignature(method, url, queryString = '', bodyString = '', timestamp) {
        const hashedBody = crypto.createHash('sha512').update(bodyString || '').digest('hex');
        const signatureString = `${method}\n${url}\n${queryString}\n${hashedBody}\n${timestamp}`;
        return crypto.createHmac('sha512', this.apiSecret).update(signatureString).digest('hex');
    }

    /**
     * Make authenticated API request
     */
    async request(method, endpoint, params = {}, body = null) {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const url = `/api/v4${endpoint}`;
        const queryString = new URLSearchParams(params).toString();
        const bodyString = body ? JSON.stringify(body) : '';

        const signature = this.generateSignature(method, url, queryString, bodyString, timestamp);

        const fullUrl = queryString
            ? `${this.baseUrl.replace('/api/v4', '')}${url}?${queryString}`
            : `${this.baseUrl.replace('/api/v4', '')}${url}`;

        const headers = {
            'Content-Type': 'application/json',
            'KEY': this.apiKey,
            'Timestamp': timestamp,
            'SIGN': signature
        };

        try {
            const response = await fetch(fullUrl, {
                method,
                headers,
                body: body ? bodyString : undefined
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(`API Error: ${data.label || data.message || JSON.stringify(data)}`);
            }

            return data;
        } catch (error) {
            console.error(`Request failed: ${method} ${endpoint}`, error.message);
            throw error;
        }
    }

    // ==================== Account ====================

    /**
     * Get futures account balance
     */
    async getBalance() {
        return await this.request('GET', `/futures/${this.settle}/accounts`);
    }

    /**
     * Get account positions
     */
    async getPositions() {
        return await this.request('GET', `/futures/${this.settle}/positions`);
    }

    /**
     * Get single contract position
     */
    async getPosition(contract) {
        return await this.request('GET', `/futures/${this.settle}/positions/${contract}`);
    }

    // ==================== Market Data ====================

    /**
     * Get all futures contracts
     */
    async getContracts() {
        return await this.request('GET', `/futures/${this.settle}/contracts`);
    }

    /**
     * Get single contract info
     */
    async getContract(contract) {
        return await this.request('GET', `/futures/${this.settle}/contracts/${contract}`);
    }

    /**
     * Get ticker for contract
     */
    async getTicker(contract) {
        const tickers = await this.request('GET', `/futures/${this.settle}/tickers`, { contract });
        return tickers[0];
    }

    /**
     * Get all tickers
     */
    async getAllTickers() {
        return await this.request('GET', `/futures/${this.settle}/tickers`);
    }

    /**
     * Get orderbook
     */
    async getOrderBook(contract, limit = 20) {
        return await this.request('GET', `/futures/${this.settle}/order_book`, {
            contract,
            limit: limit.toString()
        });
    }

    /**
     * Get recent trades
     */
    async getTrades(contract, limit = 100) {
        return await this.request('GET', `/futures/${this.settle}/trades`, {
            contract,
            limit: limit.toString()
        });
    }

    /**
     * Get candlesticks/OHLCV data
     */
    async getCandlesticks(contract, interval = '5m', limit = 100) {
        return await this.request('GET', `/futures/${this.settle}/candlesticks`, {
            contract,
            interval,
            limit: limit.toString()
        });
    }

    // ==================== Orders ====================

    /**
     * Create a futures order
     */
    async createOrder(contract, size, price = '0', options = {}) {
        const order = {
            contract,
            size: parseInt(size), // Positive for long, negative for short
            price: price.toString(),
            tif: options.tif || 'gtc',
            ...options
        };

        // For market orders, set price to 0 and use ioc
        if (options.type === 'market') {
            order.price = '0';
            order.tif = 'ioc';
        }

        return await this.request('POST', `/futures/${this.settle}/orders`, {}, order);
    }

    /**
     * Create market order
     */
    async createMarketOrder(contract, size, isLong = true) {
        const actualSize = isLong ? Math.abs(size) : -Math.abs(size);
        return await this.createOrder(contract, actualSize, '0', { tif: 'ioc' });
    }

    /**
     * Create limit order
     */
    async createLimitOrder(contract, size, price, isLong = true) {
        const actualSize = isLong ? Math.abs(size) : -Math.abs(size);
        return await this.createOrder(contract, actualSize, price);
    }

    /**
     * Create order with TP/SL (using close orders)
     */
    async createOrderWithTPSL(contract, size, price, isLong, tpPrice, slPrice) {
        // Main order
        const mainOrder = await this.createOrder(contract, isLong ? size : -size, price);

        const results = { mainOrder, tpOrder: null, slOrder: null };

        // Create TP order (reduce only)
        if (tpPrice) {
            results.tpOrder = await this.createPriceTriggeredOrder(
                contract,
                isLong ? -size : size, // Opposite direction to close
                tpPrice,
                isLong ? 'price_gte' : 'price_lte',
                { reduceOnly: true }
            );
        }

        // Create SL order (reduce only)
        if (slPrice) {
            results.slOrder = await this.createPriceTriggeredOrder(
                contract,
                isLong ? -size : size,
                slPrice,
                isLong ? 'price_lte' : 'price_gte',
                { reduceOnly: true }
            );
        }

        return results;
    }

    /**
     * Get open orders
     */
    async getOpenOrders(contract = null, options = {}) {
        const params = { status: 'open', ...options };
        if (contract) params.contract = contract;
        return await this.request('GET', `/futures/${this.settle}/orders`, params);
    }

    /**
     * Get order by ID
     */
    async getOrder(orderId) {
        return await this.request('GET', `/futures/${this.settle}/orders/${orderId}`);
    }

    /**
     * Cancel an order
     */
    async cancelOrder(orderId) {
        return await this.request('DELETE', `/futures/${this.settle}/orders/${orderId}`);
    }

    /**
     * Cancel all orders for a contract
     */
    async cancelAllOrders(contract) {
        return await this.request('DELETE', `/futures/${this.settle}/orders`, {
            contract
        });
    }

    // ==================== Price Triggered Orders (TP/SL) ====================

    /**
     * Create a price-triggered order (for TP/SL)
     * @param contract - Contract name
     * @param size - Order size (positive for buy, negative for sell)
     * @param triggerPrice - Price that triggers the order
     * @param rule - 'price_gte' (>=) or 'price_lte' (<=)
     * @param options - Additional options
     */
    async createPriceTriggeredOrder(contract, size, triggerPrice, rule, options = {}) {
        const order = {
            initial: {
                contract,
                size: parseInt(size),
                price: '0', // Market order when triggered
            },
            trigger: {
                strategy_type: 0, // 0 for price trigger
                price_type: 0, // 0 for latest price
                price: triggerPrice.toString(),
                rule: rule === 'price_gte' ? 1 : 2 // 1: >=, 2: <=
            },
            ...options
        };

        if (options.reduceOnly) {
            order.initial.reduce_only = true;
        }

        return await this.request('POST', `/futures/${this.settle}/price_orders`, {}, order);
    }

    /**
     * Set entire position TP/SL
     * @param contract - Contract name
     * @param tpPrice - Take profit price (null to skip)
     * @param slPrice - Stop loss price (null to skip)
     */
    async setEntirePositionTPSL(contract, tpPrice, slPrice) {
        const position = await this.getPosition(contract);

        if (position.size === 0) {
            throw new Error(`No open position for ${contract}`);
        }

        const isLong = position.size > 0;
        const size = Math.abs(position.size);
        const results = { tpOrder: null, slOrder: null };

        // Take profit
        if (tpPrice) {
            results.tpOrder = await this.createPriceTriggeredOrder(
                contract,
                isLong ? -size : size,
                tpPrice,
                isLong ? 'price_gte' : 'price_lte',
                { reduceOnly: true }
            );
        }

        // Stop loss
        if (slPrice) {
            results.slOrder = await this.createPriceTriggeredOrder(
                contract,
                isLong ? -size : size,
                slPrice,
                isLong ? 'price_lte' : 'price_gte',
                { reduceOnly: true }
            );
        }

        return results;
    }

    /**
     * Set partial position TP/SL
     */
    async setPartialPositionTPSL(contract, partialSize, tpPrice, slPrice) {
        const position = await this.getPosition(contract);

        if (position.size === 0) {
            throw new Error(`No open position for ${contract}`);
        }

        const isLong = position.size > 0;
        const size = Math.min(Math.abs(partialSize), Math.abs(position.size));
        const results = { tpOrder: null, slOrder: null };

        // Take profit
        if (tpPrice) {
            results.tpOrder = await this.createPriceTriggeredOrder(
                contract,
                isLong ? -size : size,
                tpPrice,
                isLong ? 'price_gte' : 'price_lte',
                { reduceOnly: true }
            );
        }

        // Stop loss
        if (slPrice) {
            results.slOrder = await this.createPriceTriggeredOrder(
                contract,
                isLong ? -size : size,
                slPrice,
                isLong ? 'price_lte' : 'price_gte',
                { reduceOnly: true }
            );
        }

        return results;
    }

    /**
     * Get price-triggered orders
     */
    async getPriceTriggeredOrders(contract = null, status = 'open') {
        const params = { status };
        if (contract) params.contract = contract;
        return await this.request('GET', `/futures/${this.settle}/price_orders`, params);
    }

    /**
     * Cancel a price-triggered order
     */
    async cancelPriceTriggeredOrder(orderId) {
        return await this.request('DELETE', `/futures/${this.settle}/price_orders/${orderId}`);
    }

    /**
     * Cancel all price-triggered orders for a contract
     */
    async cancelAllPriceTriggeredOrders(contract) {
        return await this.request('DELETE', `/futures/${this.settle}/price_orders`, {
            contract
        });
    }

    // ==================== Position Management ====================

    /**
     * Update position leverage
     */
    async setLeverage(contract, leverage) {
        return await this.request('POST', `/futures/${this.settle}/positions/${contract}/leverage`, {
            leverage: leverage.toString()
        });
    }

    /**
     * Update position risk limit
     */
    async setRiskLimit(contract, riskLimit) {
        return await this.request('POST', `/futures/${this.settle}/positions/${contract}/risk_limit`, {
            risk_limit: riskLimit.toString()
        });
    }

    /**
     * Close position
     */
    async closePosition(contract) {
        const position = await this.getPosition(contract);

        if (position.size === 0) {
            return { message: 'No position to close' };
        }

        // Create opposite market order to close
        return await this.createMarketOrder(contract, Math.abs(position.size), position.size < 0);
    }

    /**
     * Close all positions
     */
    async closeAllPositions() {
        const positions = await this.getPositions();
        const results = [];

        for (const pos of positions) {
            if (pos.size !== 0) {
                try {
                    const result = await this.closePosition(pos.contract);
                    results.push({ contract: pos.contract, success: true, result });
                } catch (error) {
                    results.push({ contract: pos.contract, success: false, error: error.message });
                }
            }
        }

        return results;
    }

    // ==================== Trailing Take Profit ====================

    /**
     * Create a trailing take profit (simulated via price monitoring)
     * Note: Gate.io doesn't have native trailing TP, this creates initial setup
     */
    async createTrailingTP(contract, activationPrice, callbackRate, size) {
        // This is a placeholder - actual trailing TP needs WebSocket monitoring
        // Use TrailingTPManager for real trailing TP functionality
        console.log(`Trailing TP setup for ${contract}:`);
        console.log(`  Activation: $${activationPrice}`);
        console.log(`  Callback: ${callbackRate * 100}%`);
        console.log(`  Size: ${size}`);

        return {
            contract,
            activationPrice,
            callbackRate,
            size,
            status: 'pending',
            message: 'Use TrailingTPManager for real-time trailing TP'
        };
    }

    // ==================== Order History ====================

    /**
     * Get order history
     */
    async getOrderHistory(contract = null, limit = 100) {
        const params = { limit: limit.toString() };
        if (contract) params.contract = contract;
        return await this.request('GET', `/futures/${this.settle}/orders`, {
            ...params,
            status: 'finished'
        });
    }

    /**
     * Get my trades
     */
    async getMyTrades(contract = null, limit = 100) {
        const params = { limit: limit.toString() };
        if (contract) params.contract = contract;
        return await this.request('GET', `/futures/${this.settle}/my_trades`, params);
    }

    /**
     * Get position history
     */
    async getPositionHistory(contract = null, limit = 100) {
        const params = { limit: limit.toString() };
        if (contract) params.contract = contract;
        return await this.request('GET', `/futures/${this.settle}/position_close`, params);
    }

    // ==================== Utility Methods ====================

    /**
     * Calculate position size from USD amount
     */
    async calculatePositionSize(contract, usdAmount, leverage = 1) {
        const ticker = await this.getTicker(contract);
        const contractInfo = await this.getContract(contract);

        const price = parseFloat(ticker.last);
        const quantoMultiplier = parseFloat(contractInfo.quanto_multiplier || 1);

        const notionalValue = usdAmount * leverage;
        const contracts = Math.floor(notionalValue / (price * quantoMultiplier));

        return {
            contract,
            price,
            usdAmount,
            leverage,
            contracts,
            quantoMultiplier,
            notionalValue: contracts * price * quantoMultiplier,
            margin: (contracts * price * quantoMultiplier) / leverage
        };
    }

    /**
     * Format contract name
     */
    formatContract(symbol) {
        // Convert BTC/USDT or BTCUSDT to BTC_USDT
        return symbol.replace('/', '_').replace(/([A-Z]+)(USDT)$/i, '$1_$2').toUpperCase();
    }
}

export default GateFuturesREST;
