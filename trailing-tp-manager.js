import { EventEmitter } from 'events';

/**
 * Trailing Take Profit Manager
 * Monitors prices via WebSocket and manages trailing take profits
 */
export class TrailingTPManager extends EventEmitter {
    constructor(wsClient, restClient) {
        super();
        this.ws = wsClient;
        this.rest = restClient;

        // Active trailing TPs: contract -> { activationPrice, callbackRate, size, isLong, status, highestPrice, tpPrice }
        this.trailingTPs = new Map();

        // Statistics
        this.stats = {
            totalActivated: 0,
            totalTriggered: 0,
            totalPnL: 0
        };

        // Setup price monitoring
        this.setupPriceMonitoring();
    }

    /**
     * Setup WebSocket price monitoring
     */
    setupPriceMonitoring() {
        this.ws.on('ticker', ({ contract, price }) => {
            this.checkTrailingTP(contract, price);
        });
    }

    /**
     * Add a new trailing take profit
     * @param contract - Contract name (e.g., 'BTC_USDT')
     * @param activationPrice - Price at which trailing TP activates
     * @param callbackRate - Callback rate (e.g., 0.02 for 2%)
     * @param size - Position size to close
     * @param options - Additional options { isLong: true/false }
     */
    addTrailingTP(contract, activationPrice, callbackRate, size, options = {}) {
        const formattedContract = this.formatContract(contract);

        // Determine if long or short based on current position if not specified
        const isLong = options.isLong !== undefined ? options.isLong : true;

        const trailingTP = {
            contract: formattedContract,
            activationPrice: parseFloat(activationPrice),
            callbackRate: parseFloat(callbackRate),
            size: Math.abs(parseInt(size)),
            isLong,
            status: 'pending', // pending, active, triggered, cancelled
            highestPrice: isLong ? 0 : Infinity,
            lowestPrice: isLong ? Infinity : 0,
            tpPrice: null,
            createdAt: new Date(),
            activatedAt: null,
            triggeredAt: null
        };

        this.trailingTPs.set(formattedContract, trailingTP);

        // Ensure we're subscribed to this contract's ticker
        this.ws.subscribeTickers([formattedContract]);

        console.log(`Trailing TP added for ${formattedContract}:`);
        console.log(`  Direction: ${isLong ? 'LONG' : 'SHORT'}`);
        console.log(`  Activation: $${activationPrice}`);
        console.log(`  Callback: ${callbackRate * 100}%`);
        console.log(`  Size: ${size}`);

        this.emit('trailing-added', trailingTP);

        return trailingTP;
    }

    /**
     * Check and update trailing TP based on current price
     */
    async checkTrailingTP(contract, currentPrice) {
        const trailing = this.trailingTPs.get(contract);
        if (!trailing) return;

        const { status, isLong, activationPrice, callbackRate, size, highestPrice, lowestPrice } = trailing;

        // Skip if already triggered or cancelled
        if (status === 'triggered' || status === 'cancelled') return;

        // Check for activation
        if (status === 'pending') {
            const shouldActivate = isLong
                ? currentPrice >= activationPrice
                : currentPrice <= activationPrice;

            if (shouldActivate) {
                trailing.status = 'active';
                trailing.activatedAt = new Date();
                trailing.highestPrice = isLong ? currentPrice : highestPrice;
                trailing.lowestPrice = isLong ? lowestPrice : currentPrice;

                this.stats.totalActivated++;

                console.log(`🚀 Trailing TP ACTIVATED for ${contract} @ $${currentPrice.toFixed(2)}`);
                this.emit('trailing-activated', { contract, price: currentPrice, trailing });
            }
            return;
        }

        // Update highest/lowest price for active trailing TP
        if (status === 'active') {
            if (isLong) {
                // For long positions, track highest price
                if (currentPrice > trailing.highestPrice) {
                    trailing.highestPrice = currentPrice;
                    trailing.tpPrice = currentPrice * (1 - callbackRate);

                    console.log(`📊 ${contract} New high: $${currentPrice.toFixed(2)} | TP: $${trailing.tpPrice.toFixed(2)}`);
                    this.emit('trailing-updated', {
                        contract,
                        price: currentPrice,
                        newHighestPrice: trailing.highestPrice,
                        newTpPrice: trailing.tpPrice
                    });
                }

                // Check if price dropped to TP level
                if (trailing.tpPrice && currentPrice <= trailing.tpPrice) {
                    await this.triggerTrailingTP(contract, currentPrice);
                }
            } else {
                // For short positions, track lowest price
                if (currentPrice < trailing.lowestPrice) {
                    trailing.lowestPrice = currentPrice;
                    trailing.tpPrice = currentPrice * (1 + callbackRate);

                    console.log(`📊 ${contract} New low: $${currentPrice.toFixed(2)} | TP: $${trailing.tpPrice.toFixed(2)}`);
                    this.emit('trailing-updated', {
                        contract,
                        price: currentPrice,
                        newLowestPrice: trailing.lowestPrice,
                        newTpPrice: trailing.tpPrice
                    });
                }

                // Check if price rose to TP level
                if (trailing.tpPrice && currentPrice >= trailing.tpPrice) {
                    await this.triggerTrailingTP(contract, currentPrice);
                }
            }
        }
    }

    /**
     * Trigger trailing TP - execute close order
     */
    async triggerTrailingTP(contract, currentPrice) {
        const trailing = this.trailingTPs.get(contract);
        if (!trailing || trailing.status !== 'active') return;

        trailing.status = 'triggered';
        trailing.triggeredAt = new Date();

        console.log(`✅ Trailing TP TRIGGERED for ${contract} @ $${currentPrice.toFixed(2)}`);

        try {
            // Execute close order via REST API
            const result = await this.rest.createMarketOrder(
                contract,
                trailing.size,
                !trailing.isLong // Opposite direction to close
            );

            // Calculate PnL
            const entryPrice = trailing.activationPrice; // Approximation
            const pnl = trailing.isLong
                ? (currentPrice - entryPrice) * trailing.size
                : (entryPrice - currentPrice) * trailing.size;

            trailing.result = result;
            trailing.pnl = pnl;
            this.stats.totalTriggered++;
            this.stats.totalPnL += pnl;

            console.log(`  Order executed: ${JSON.stringify(result)}`);
            console.log(`  Estimated PnL: $${pnl.toFixed(2)}`);

            this.emit('trailing-triggered', {
                contract,
                price: currentPrice,
                trailing,
                result,
                pnl
            });

        } catch (error) {
            console.error(`Failed to execute trailing TP for ${contract}:`, error.message);
            trailing.status = 'active'; // Reset to active on failure
            trailing.error = error.message;

            this.emit('trailing-error', { contract, error: error.message, trailing });
        }
    }

    /**
     * Cancel a trailing TP
     */
    cancelTrailingTP(contract) {
        const formattedContract = this.formatContract(contract);
        const trailing = this.trailingTPs.get(formattedContract);

        if (!trailing) {
            return { success: false, message: 'Trailing TP not found' };
        }

        if (trailing.status === 'triggered') {
            return { success: false, message: 'Trailing TP already triggered' };
        }

        trailing.status = 'cancelled';
        trailing.cancelledAt = new Date();

        console.log(`❌ Trailing TP cancelled for ${formattedContract}`);

        this.emit('trailing-cancelled', { contract: formattedContract, trailing });

        return { success: true, trailing };
    }

    /**
     * Remove a trailing TP from tracking
     */
    removeTrailingTP(contract) {
        const formattedContract = this.formatContract(contract);
        const removed = this.trailingTPs.delete(formattedContract);

        if (removed) {
            console.log(`Trailing TP removed for ${formattedContract}`);
        }

        return removed;
    }

    /**
     * Get trailing TP status
     */
    getTrailingTP(contract) {
        return this.trailingTPs.get(this.formatContract(contract));
    }

    /**
     * Get all active trailing TPs
     */
    getAllTrailingTPs() {
        return Array.from(this.trailingTPs.values());
    }

    /**
     * Get active trailing TPs
     */
    getActiveTrailingTPs() {
        return this.getAllTrailingTPs().filter(t => t.status === 'active' || t.status === 'pending');
    }

    /**
     * Update trailing TP settings
     */
    updateTrailingTP(contract, updates) {
        const formattedContract = this.formatContract(contract);
        const trailing = this.trailingTPs.get(formattedContract);

        if (!trailing) {
            return { success: false, message: 'Trailing TP not found' };
        }

        if (trailing.status === 'triggered') {
            return { success: false, message: 'Cannot update triggered trailing TP' };
        }

        if (updates.activationPrice) trailing.activationPrice = parseFloat(updates.activationPrice);
        if (updates.callbackRate) trailing.callbackRate = parseFloat(updates.callbackRate);
        if (updates.size) trailing.size = Math.abs(parseInt(updates.size));

        console.log(`Trailing TP updated for ${formattedContract}:`, updates);

        this.emit('trailing-updated-settings', { contract: formattedContract, trailing, updates });

        return { success: true, trailing };
    }

    /**
     * Print statistics
     */
    printStats() {
        console.log('\n' + '='.repeat(60));
        console.log('📊 Trailing TP Statistics');
        console.log('='.repeat(60));
        console.log(`Total Activated: ${this.stats.totalActivated}`);
        console.log(`Total Triggered: ${this.stats.totalTriggered}`);
        console.log(`Total PnL: $${this.stats.totalPnL.toFixed(2)}`);
        console.log('='.repeat(60));

        const activeCount = this.getActiveTrailingTPs().length;
        if (activeCount > 0) {
            console.log(`\nActive Trailing TPs: ${activeCount}`);
            for (const trailing of this.getActiveTrailingTPs()) {
                console.log(`  ${trailing.contract}:`);
                console.log(`    Status: ${trailing.status}`);
                console.log(`    Direction: ${trailing.isLong ? 'LONG' : 'SHORT'}`);
                console.log(`    Activation: $${trailing.activationPrice}`);
                console.log(`    Callback: ${trailing.callbackRate * 100}%`);
                console.log(`    Size: ${trailing.size}`);
                if (trailing.tpPrice) {
                    console.log(`    Current TP: $${trailing.tpPrice.toFixed(2)}`);
                }
            }
        }
        console.log('='.repeat(60) + '\n');
    }

    /**
     * Format contract name
     */
    formatContract(symbol) {
        return symbol.replace('/', '_').replace(/([A-Z]+)(USDT)$/i, '$1_$2').toUpperCase();
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            totalActivated: 0,
            totalTriggered: 0,
            totalPnL: 0
        };
    }

    /**
     * Clear all trailing TPs
     */
    clearAll() {
        this.trailingTPs.clear();
        console.log('All trailing TPs cleared');
    }
}

export default TrailingTPManager;
