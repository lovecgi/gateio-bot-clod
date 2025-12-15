#!/usr/bin/env node

import dotenv from 'dotenv';
import { GateFuturesREST } from './gate-futures-rest.js';
import { GateFuturesWebSocket } from './gate-futures-websocket.js';
import { TrailingTPManager } from './trailing-tp-manager.js';

dotenv.config();

/**
 * Real-Time Trading Bot
 * Supports multiple trading strategies: Scalping, Breakout, Grid
 */
class RealTimeTradingBot {
    constructor(apiKey = null, apiSecret = null, options = {}) {
        this.apiKey = apiKey || process.env.GATE_API_KEY;
        this.apiSecret = apiSecret || process.env.GATE_API_SECRET;
        this.testnet = options.testnet || process.env.USE_TESTNET === 'true';

        // Initialize clients
        this.rest = new GateFuturesREST(this.apiKey, this.apiSecret, { testnet: this.testnet });
        this.ws = new GateFuturesWebSocket(this.apiKey, this.apiSecret, { testnet: this.testnet });
        this.trailingManager = null;

        // Bot state
        this.isRunning = false;
        this.contracts = [];
        this.strategy = null;
        this.positions = new Map();
        this.orders = new Map();
        this.priceHistory = new Map();

        // Default settings
        this.settings = {
            leverage: parseInt(process.env.LEVERAGE) || 10,
            positionSize: parseInt(process.env.POSITION_SIZE) || 10,
            trailingCallback: parseFloat(process.env.TRAILING_CALLBACK) || 0.02,
            maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS) || 5,
            ...options
        };

        // Statistics
        this.stats = {
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            totalPnL: 0,
            startTime: null
        };
    }

    /**
     * Run the trading bot
     * @param contracts - List of contracts to trade (e.g., ['BTC_USDT', 'ETH_USDT'])
     * @param strategyName - Strategy name: 'scalping', 'breakout', 'grid'
     */
    async run(contracts, strategyName = 'scalping') {
        console.log('\n' + '='.repeat(60));
        console.log('🤖 Gate.io Futures Trading Bot');
        console.log('='.repeat(60));
        console.log(`Strategy: ${strategyName.toUpperCase()}`);
        console.log(`Contracts: ${contracts.join(', ')}`);
        console.log(`Testnet: ${this.testnet}`);
        console.log(`Leverage: ${this.settings.leverage}x`);
        console.log('='.repeat(60) + '\n');

        try {
            this.contracts = contracts.map(c => this.formatContract(c));
            this.stats.startTime = new Date();

            // Connect to WebSocket
            console.log('Connecting to WebSocket...');
            await this.ws.connect();

            // Initialize trailing manager
            this.trailingManager = new TrailingTPManager(this.ws, this.rest);
            this.setupTrailingEvents();

            // Load strategy
            this.strategy = this.loadStrategy(strategyName);

            // Subscribe to market data
            this.ws.subscribeTickers(this.contracts);
            this.ws.subscribeTrades(this.contracts);
            this.ws.subscribeCandlesticks(this.contracts, '1m');

            // Setup event handlers
            this.setupEventHandlers();

            // Sync existing positions
            await this.syncPositions();

            this.isRunning = true;
            console.log('✅ Bot started successfully!\n');

            // Keep process running
            this.keepAlive();

        } catch (error) {
            console.error('Failed to start bot:', error.message);
            throw error;
        }
    }

    /**
     * Load trading strategy
     */
    loadStrategy(name) {
        const strategies = {
            scalping: new ScalpingStrategy(this),
            breakout: new BreakoutStrategy(this),
            grid: new GridStrategy(this)
        };

        const strategy = strategies[name.toLowerCase()];
        if (!strategy) {
            throw new Error(`Unknown strategy: ${name}`);
        }

        console.log(`Strategy loaded: ${name}`);
        return strategy;
    }

    /**
     * Setup WebSocket event handlers
     */
    setupEventHandlers() {
        // Price ticker updates
        this.ws.on('ticker', ({ contract, price, data }) => {
            this.handleTickerUpdate(contract, price, data);
        });

        // Trade updates
        this.ws.on('trade', ({ contract, price, size, side }) => {
            this.handleTradeUpdate(contract, price, size, side);
        });

        // Candlestick updates
        this.ws.on('candlestick', (candle) => {
            this.handleCandlestickUpdate(candle);
        });

        // Connection events
        this.ws.on('disconnected', () => {
            console.log('⚠️ WebSocket disconnected');
        });

        this.ws.on('connected', () => {
            console.log('✅ WebSocket reconnected');
            this.ws.subscribeTickers(this.contracts);
        });

        // Error handling
        this.ws.on('error', (error) => {
            console.error('WebSocket error:', error.message);
        });
    }

    /**
     * Setup trailing manager events
     */
    setupTrailingEvents() {
        this.trailingManager.on('trailing-activated', ({ contract, price }) => {
            console.log(`🚀 Trailing TP activated for ${contract} @ $${price.toFixed(2)}`);
        });

        this.trailingManager.on('trailing-triggered', ({ contract, price, pnl }) => {
            console.log(`✅ Trailing TP triggered for ${contract} @ $${price.toFixed(2)}, PnL: $${pnl?.toFixed(2) || 'N/A'}`);
            this.positions.delete(contract);
            this.updateStats(pnl || 0);
        });

        this.trailingManager.on('trailing-updated', ({ contract, newTpPrice }) => {
            // Quiet update - only log significant changes
        });
    }

    /**
     * Handle ticker updates
     */
    handleTickerUpdate(contract, price, data) {
        // Update price history
        if (!this.priceHistory.has(contract)) {
            this.priceHistory.set(contract, []);
        }
        const history = this.priceHistory.get(contract);
        history.push({ price, timestamp: Date.now() });

        // Keep last 1000 prices
        if (history.length > 1000) {
            history.shift();
        }

        // Run strategy
        if (this.strategy && this.contracts.includes(contract)) {
            this.strategy.onTick(contract, price, data);
        }
    }

    /**
     * Handle trade updates
     */
    handleTradeUpdate(contract, price, size, side) {
        if (this.strategy) {
            this.strategy.onTrade(contract, price, size, side);
        }
    }

    /**
     * Handle candlestick updates
     */
    handleCandlestickUpdate(candle) {
        if (this.strategy) {
            this.strategy.onCandlestick(candle);
        }
    }

    /**
     * Sync positions from exchange
     */
    async syncPositions() {
        try {
            const positions = await this.rest.getPositions();

            for (const pos of positions) {
                if (pos.size !== 0 && this.contracts.includes(pos.contract)) {
                    this.positions.set(pos.contract, {
                        size: pos.size,
                        entryPrice: parseFloat(pos.entry_price),
                        leverage: pos.leverage,
                        unrealizedPnl: parseFloat(pos.unrealised_pnl || 0)
                    });
                    console.log(`Synced position: ${pos.contract} - Size: ${pos.size}, Entry: $${pos.entry_price}`);
                }
            }

            console.log(`Synced ${this.positions.size} positions`);
        } catch (error) {
            console.error('Failed to sync positions:', error.message);
        }
    }

    /**
     * Open a position
     */
    async openPosition(contract, isLong, size = null, options = {}) {
        const positionSize = size || this.settings.positionSize;

        console.log(`Opening ${isLong ? 'LONG' : 'SHORT'} position: ${positionSize} ${contract}`);

        try {
            // Set leverage
            await this.rest.setLeverage(contract, this.settings.leverage);

            // Create market order
            const order = await this.rest.createMarketOrder(contract, positionSize, isLong);

            // Get current price
            const ticker = await this.rest.getTicker(contract);
            const entryPrice = parseFloat(ticker.last);

            // Track position
            this.positions.set(contract, {
                size: isLong ? positionSize : -positionSize,
                entryPrice,
                leverage: this.settings.leverage,
                openedAt: new Date()
            });

            this.stats.totalTrades++;

            console.log(`✅ Position opened: ${contract} @ $${entryPrice.toFixed(2)}`);

            // Setup TP/SL if specified
            if (options.tpPrice || options.slPrice) {
                await this.rest.setEntirePositionTPSL(contract, options.tpPrice, options.slPrice);
            }

            // Setup trailing TP if specified
            if (options.trailingActivation) {
                this.trailingManager.addTrailingTP(
                    contract,
                    options.trailingActivation,
                    options.trailingCallback || this.settings.trailingCallback,
                    positionSize,
                    { isLong }
                );
            }

            return { success: true, order, entryPrice };

        } catch (error) {
            console.error(`Failed to open position: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Close a position
     */
    async closePosition(contract, reason = 'manual') {
        const position = this.positions.get(contract);
        if (!position) {
            return { success: false, message: 'No position to close' };
        }

        console.log(`Closing position: ${contract} (${reason})`);

        try {
            const order = await this.rest.closePosition(contract);

            // Get exit price
            const ticker = await this.rest.getTicker(contract);
            const exitPrice = parseFloat(ticker.last);

            // Calculate PnL
            const pnl = position.size > 0
                ? (exitPrice - position.entryPrice) * Math.abs(position.size)
                : (position.entryPrice - exitPrice) * Math.abs(position.size);

            this.updateStats(pnl);
            this.positions.delete(contract);

            // Cancel trailing TP
            this.trailingManager.cancelTrailingTP(contract);

            console.log(`✅ Position closed: ${contract} @ $${exitPrice.toFixed(2)}, PnL: $${pnl.toFixed(2)}`);

            return { success: true, exitPrice, pnl, reason };

        } catch (error) {
            console.error(`Failed to close position: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Update statistics
     */
    updateStats(pnl) {
        this.stats.totalPnL += pnl;
        if (pnl > 0) {
            this.stats.winningTrades++;
        } else {
            this.stats.losingTrades++;
        }
    }

    /**
     * Print statistics
     */
    printStats() {
        const runtime = this.stats.startTime
            ? Math.floor((Date.now() - this.stats.startTime.getTime()) / 1000 / 60)
            : 0;

        const winRate = this.stats.totalTrades > 0
            ? ((this.stats.winningTrades / this.stats.totalTrades) * 100).toFixed(1)
            : 0;

        console.log('\n' + '='.repeat(60));
        console.log('📊 Trading Statistics');
        console.log('='.repeat(60));
        console.log(`Runtime: ${runtime} minutes`);
        console.log(`Total Trades: ${this.stats.totalTrades}`);
        console.log(`Winning: ${this.stats.winningTrades} | Losing: ${this.stats.losingTrades}`);
        console.log(`Win Rate: ${winRate}%`);
        console.log(`Total PnL: $${this.stats.totalPnL.toFixed(2)}`);
        console.log(`Active Positions: ${this.positions.size}`);
        console.log('='.repeat(60) + '\n');
    }

    /**
     * Stop the bot
     */
    async stop() {
        console.log('\nStopping bot...');
        this.isRunning = false;

        // Close all positions
        for (const contract of this.positions.keys()) {
            await this.closePosition(contract, 'bot_stop');
        }

        // Disconnect WebSocket
        this.ws.disconnect();

        this.printStats();
        console.log('Bot stopped.');
    }

    /**
     * Keep the process alive
     */
    keepAlive() {
        // Print stats periodically
        setInterval(() => {
            if (this.isRunning) {
                this.printStats();
            }
        }, 60000 * 5); // Every 5 minutes

        // Handle shutdown
        process.on('SIGINT', async () => {
            await this.stop();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            await this.stop();
            process.exit(0);
        });
    }

    /**
     * Format contract name
     */
    formatContract(symbol) {
        return symbol.replace('/', '_').replace(/([A-Z]+)(USDT)$/i, '$1_$2').toUpperCase();
    }

    /**
     * Get price history for a contract
     */
    getPriceHistory(contract, limit = 100) {
        const history = this.priceHistory.get(contract) || [];
        return history.slice(-limit);
    }

    /**
     * Get current position
     */
    getPosition(contract) {
        return this.positions.get(contract);
    }

    /**
     * Check if position exists
     */
    hasPosition(contract) {
        return this.positions.has(contract);
    }
}

// ==================== STRATEGIES ====================

/**
 * Scalping Strategy
 * Quick entries and exits with small profit targets
 */
class ScalpingStrategy {
    constructor(bot) {
        this.bot = bot;
        this.settings = {
            tpPercent: 0.003,   // 0.3% take profit
            slPercent: 0.002,   // 0.2% stop loss
            minStrength: 0.7,   // Minimum signal strength
            cooldown: 60000     // 1 minute cooldown between trades
        };
        this.lastTradeTime = new Map();
        this.signals = new Map();
    }

    onTick(contract, price, data) {
        // Check cooldown
        const lastTrade = this.lastTradeTime.get(contract) || 0;
        if (Date.now() - lastTrade < this.settings.cooldown) return;

        // Skip if already in position
        if (this.bot.hasPosition(contract)) {
            this.checkExit(contract, price);
            return;
        }

        // Calculate signal
        const signal = this.calculateSignal(contract, price, data);
        this.signals.set(contract, signal);

        // Execute if signal strong enough
        if (Math.abs(signal.strength) >= this.settings.minStrength) {
            this.executeEntry(contract, price, signal);
        }
    }

    calculateSignal(contract, price, data) {
        const history = this.bot.getPriceHistory(contract, 60);
        if (history.length < 20) return { direction: 'none', strength: 0 };

        // Calculate momentum
        const prices = history.map(h => h.price);
        const shortMA = this.sma(prices, 5);
        const longMA = this.sma(prices, 20);

        // Calculate price change
        const changePercent = parseFloat(data.change_percentage || 0);

        // Determine direction and strength
        let direction = 'none';
        let strength = 0;

        if (shortMA > longMA && changePercent > 0) {
            direction = 'long';
            strength = Math.min((shortMA - longMA) / longMA * 100 + Math.abs(changePercent) * 0.1, 1);
        } else if (shortMA < longMA && changePercent < 0) {
            direction = 'short';
            strength = Math.min((longMA - shortMA) / longMA * 100 + Math.abs(changePercent) * 0.1, 1);
        }

        return { direction, strength, shortMA, longMA, changePercent };
    }

    async executeEntry(contract, price, signal) {
        const isLong = signal.direction === 'long';
        const tp = isLong
            ? price * (1 + this.settings.tpPercent)
            : price * (1 - this.settings.tpPercent);
        const sl = isLong
            ? price * (1 - this.settings.slPercent)
            : price * (1 + this.settings.slPercent);

        console.log(`\n📈 Scalping Signal: ${contract} ${signal.direction.toUpperCase()}`);
        console.log(`   Price: $${price.toFixed(2)}, Strength: ${(signal.strength * 100).toFixed(1)}%`);
        console.log(`   TP: $${tp.toFixed(2)}, SL: $${sl.toFixed(2)}`);

        const result = await this.bot.openPosition(contract, isLong, null, {
            tpPrice: tp.toString(),
            slPrice: sl.toString()
        });

        if (result.success) {
            this.lastTradeTime.set(contract, Date.now());
        }
    }

    checkExit(contract, price) {
        const position = this.bot.getPosition(contract);
        if (!position) return;

        const pnlPercent = position.size > 0
            ? (price - position.entryPrice) / position.entryPrice
            : (position.entryPrice - price) / position.entryPrice;

        // Check TP/SL (in case exchange orders didn't trigger)
        if (pnlPercent >= this.settings.tpPercent || pnlPercent <= -this.settings.slPercent) {
            this.bot.closePosition(contract, pnlPercent > 0 ? 'take_profit' : 'stop_loss');
        }
    }

    onTrade(contract, price, size, side) {
        // Volume analysis for scalping (optional enhancement)
    }

    onCandlestick(candle) {
        // Candle pattern analysis (optional)
    }

    sma(values, period) {
        const slice = values.slice(-period);
        return slice.reduce((a, b) => a + b, 0) / slice.length;
    }
}

/**
 * Breakout Strategy
 * Trades price breakouts with trailing take profit
 */
class BreakoutStrategy {
    constructor(bot) {
        this.bot = bot;
        this.settings = {
            lookbackPeriod: 60,     // 1 hour of 1m candles
            breakoutThreshold: 0.005, // 0.5% breakout
            trailingActivation: 0.01, // 1% profit to activate trailing
            trailingCallback: 0.02,   // 2% callback
            slPercent: 0.015          // 1.5% stop loss
        };
        this.levels = new Map();
    }

    onTick(contract, price, data) {
        // Update support/resistance levels
        this.updateLevels(contract, price);

        // Skip if in position
        if (this.bot.hasPosition(contract)) {
            return;
        }

        // Check for breakout
        const breakout = this.checkBreakout(contract, price);
        if (breakout) {
            this.executeBreakout(contract, price, breakout);
        }
    }

    updateLevels(contract, price) {
        const history = this.bot.getPriceHistory(contract, this.settings.lookbackPeriod);
        if (history.length < this.settings.lookbackPeriod) return;

        const prices = history.map(h => h.price);
        const high = Math.max(...prices);
        const low = Math.min(...prices);

        this.levels.set(contract, { high, low, updated: Date.now() });
    }

    checkBreakout(contract, price) {
        const levels = this.levels.get(contract);
        if (!levels) return null;

        const { high, low } = levels;
        const threshold = this.settings.breakoutThreshold;

        // Bullish breakout
        if (price > high * (1 + threshold)) {
            return { direction: 'long', level: high };
        }

        // Bearish breakout
        if (price < low * (1 - threshold)) {
            return { direction: 'short', level: low };
        }

        return null;
    }

    async executeBreakout(contract, price, breakout) {
        const isLong = breakout.direction === 'long';

        console.log(`\n🚀 Breakout Signal: ${contract} ${breakout.direction.toUpperCase()}`);
        console.log(`   Price: $${price.toFixed(2)}, Level: $${breakout.level.toFixed(2)}`);

        const sl = isLong
            ? price * (1 - this.settings.slPercent)
            : price * (1 + this.settings.slPercent);

        const trailingActivation = isLong
            ? price * (1 + this.settings.trailingActivation)
            : price * (1 - this.settings.trailingActivation);

        const result = await this.bot.openPosition(contract, isLong, null, {
            slPrice: sl.toString(),
            trailingActivation,
            trailingCallback: this.settings.trailingCallback
        });

        if (result.success) {
            // Clear levels for this contract
            this.levels.delete(contract);
        }
    }

    onTrade(contract, price, size, side) {
        // Volume spike detection for breakout confirmation
    }

    onCandlestick(candle) {
        // Additional candle analysis
    }
}

/**
 * Grid Trading Strategy
 * Places orders at regular intervals within a range
 */
class GridStrategy {
    constructor(bot) {
        this.bot = bot;
        this.settings = {
            gridLevels: 10,        // Number of grid levels
            gridSpacing: 0.005,    // 0.5% spacing between levels
            tpPercent: 0.003,      // 0.3% take profit per grid
            sizePerGrid: null      // Will be calculated
        };
        this.grids = new Map();
        this.initialized = new Map();
    }

    onTick(contract, price, data) {
        // Initialize grid for contract
        if (!this.initialized.get(contract)) {
            this.initializeGrid(contract, price);
            this.initialized.set(contract, true);
        }

        // Check grid levels
        this.checkGrid(contract, price);
    }

    initializeGrid(contract, price) {
        const levels = [];
        const spacing = this.settings.gridSpacing;
        const halfLevels = Math.floor(this.settings.gridLevels / 2);

        // Create grid levels above and below current price
        for (let i = -halfLevels; i <= halfLevels; i++) {
            if (i === 0) continue; // Skip current price level

            const levelPrice = price * (1 + spacing * i);
            levels.push({
                price: levelPrice,
                type: i > 0 ? 'sell' : 'buy',
                filled: false,
                position: null
            });
        }

        this.grids.set(contract, {
            levels,
            centerPrice: price,
            lastUpdate: Date.now()
        });

        console.log(`\n📊 Grid initialized for ${contract}`);
        console.log(`   Center: $${price.toFixed(2)}`);
        console.log(`   Levels: ${levels.length}`);
        console.log(`   Spacing: ${spacing * 100}%`);
    }

    async checkGrid(contract, price) {
        const grid = this.grids.get(contract);
        if (!grid) return;

        for (const level of grid.levels) {
            // Skip filled levels
            if (level.filled) continue;

            // Check if price crossed level
            const crossedUp = level.type === 'buy' && price <= level.price;
            const crossedDown = level.type === 'sell' && price >= level.price;

            if (crossedUp || crossedDown) {
                await this.executeGridOrder(contract, level, price);
            }
        }

        // Check for grid exits
        this.checkGridExits(contract, price);
    }

    async executeGridOrder(contract, level, price) {
        const isLong = level.type === 'buy';
        const tp = isLong
            ? level.price * (1 + this.settings.tpPercent)
            : level.price * (1 - this.settings.tpPercent);

        console.log(`\n📊 Grid ${level.type.toUpperCase()}: ${contract} @ $${level.price.toFixed(2)}`);

        const result = await this.bot.openPosition(contract, isLong, this.settings.sizePerGrid, {
            tpPrice: tp.toString()
        });

        if (result.success) {
            level.filled = true;
            level.position = {
                entryPrice: result.entryPrice,
                tp,
                openedAt: Date.now()
            };
        }
    }

    checkGridExits(contract, price) {
        const grid = this.grids.get(contract);
        if (!grid) return;

        for (const level of grid.levels) {
            if (!level.filled || !level.position) continue;

            const { entryPrice, tp } = level.position;
            const isLong = level.type === 'buy';

            // Check if TP reached
            const tpReached = isLong ? price >= tp : price <= tp;

            if (tpReached) {
                console.log(`✅ Grid TP: ${contract} @ $${price.toFixed(2)}`);
                level.filled = false;
                level.position = null;
                // Note: Actual position close is handled by exchange TP order
            }
        }
    }

    onTrade(contract, price, size, side) {
        // Volume analysis
    }

    onCandlestick(candle) {
        // Trend analysis for grid adjustment
    }
}

// ==================== CLI ====================

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log(`
Gate.io Futures Trading Bot

Usage:
  node trading-bot.js <strategy> [contracts...]

Strategies:
  scalping   - Quick entries/exits with small targets (0.3% TP, 0.2% SL)
  breakout   - Trade price breakouts with trailing TP
  grid       - Grid trading within price ranges

Examples:
  node trading-bot.js scalping BTC_USDT
  node trading-bot.js breakout BTC_USDT ETH_USDT
  node trading-bot.js grid BTC_USDT

Environment Variables:
  GATE_API_KEY      - Gate.io API key
  GATE_API_SECRET   - Gate.io API secret
  USE_TESTNET       - Use testnet (true/false)
  LEVERAGE          - Default leverage (default: 10)
  POSITION_SIZE     - Default position size (default: 10)
        `);
        process.exit(0);
    }

    const strategy = args[0];
    const contracts = args.slice(1);

    if (contracts.length === 0) {
        contracts.push('BTC_USDT');
    }

    // Validate environment
    if (!process.env.GATE_API_KEY || !process.env.GATE_API_SECRET) {
        console.error('Error: GATE_API_KEY and GATE_API_SECRET must be set in .env file');
        process.exit(1);
    }

    // Start bot
    const bot = new RealTimeTradingBot();
    await bot.run(contracts, strategy);
}

// Export for module usage
export default RealTimeTradingBot;
export { ScalpingStrategy, BreakoutStrategy, GridStrategy };

// Run if executed directly
main().catch(console.error);
