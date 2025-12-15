import WebSocket from 'ws';
import EventEmitter from 'events';
import crypto from 'crypto';

/**
 * Gate.io Futures WebSocket Service
 * Handles real-time data streaming from Gate.io
 */
class GateFuturesWebsocket extends EventEmitter {
    constructor() {
        super();
        this.ws = null;
        this.baseUrl = 'wss://fx-ws.gateio.ws/v4/ws/usdt';
        this.pingInterval = null;
        this.subscriptions = new Set();
        this.isConnected = false;
        this.reconnectTimer = null;
    }

    /**
     * Initialize and connect
     */
    connect() {
        if (this.ws) {
            this.ws.terminate();
        }

        console.log('Connecting to Gate.io WebSocket...');
        this.ws = new WebSocket(this.baseUrl);

        this.ws.on('open', () => {
            console.log('Gate.io WebSocket connected');
            this.isConnected = true;
            this.startPing();
            this.resubscribe();
            this.emit('connected');
        });

        this.ws.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                this.handleMessage(message);
            } catch (error) {
                console.error('WebSocket message parse error:', error);
            }
        });

        this.ws.on('close', () => {
            console.log('Gate.io WebSocket disconnected');
            this.isConnected = false;
            this.stopPing();
            this.scheduleReconnect();
            this.emit('disconnected');
        });

        this.ws.on('error', (error) => {
            console.error('Gate.io WebSocket error:', error.message);
        });
    }

    /**
     * Schedule reconnection
     */
    scheduleReconnect() {
        if (this.reconnectTimer) return;

        console.log('Scheduling reconnect in 5s...');
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, 5000);
    }

    /**
     * Start keep-alive ping
     */
    startPing() {
        this.stopPing();
        this.pingInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    time: Date.now(),
                    channel: 'spot.ping' // Using spot ping channel as generic keepalive
                }));
            }
        }, 15000);
    }

    /**
     * Stop keep-alive ping
     */
    stopPing() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    /**
     * Subscribe to tickers
     * @param {string[]} symbols - Array of symbols (e.g., ['BTC_USDT'])
     */
    subscribeTickers(symbols) {
        const formattedSymbols = symbols.map(s => s.replace('/', '_').toUpperCase());

        // Add to subscriptions set
        formattedSymbols.forEach(s => this.subscriptions.add(s));

        if (this.isConnected) {
            this.send({
                time: Date.now(),
                channel: 'futures.tickers',
                event: 'subscribe',
                payload: formattedSymbols
            });
        }
    }

    /**
     * Resubscribe to all channels
     */
    resubscribe() {
        if (this.subscriptions.size > 0) {
            this.send({
                time: Date.now(),
                channel: 'futures.tickers',
                event: 'subscribe',
                payload: Array.from(this.subscriptions)
            });
        }
    }

    /**
     * Send message to WebSocket
     */
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    /**
     * Handle incoming messages
     */
    handleMessage(message) {
        // Handle Ticker Updates
        if (message.channel === 'futures.tickers' && message.event === 'update') {
            const tickerData = message.result;
            if (Array.isArray(tickerData)) {
                tickerData.forEach(ticker => {
                    this.emit('ticker', {
                        symbol: ticker.contract.replace('_', '/'),
                        last: parseFloat(ticker.last),
                        change_percentage: parseFloat(ticker.change_percentage),
                        mark_price: parseFloat(ticker.mark_price),
                        index_price: parseFloat(ticker.index_price),
                        volume_24h: parseFloat(ticker.volume_24h)
                    });
                });
            } else {
                this.emit('ticker', {
                    symbol: tickerData.contract.replace('_', '/'),
                    last: parseFloat(tickerData.last),
                    change_percentage: parseFloat(tickerData.change_percentage),
                    mark_price: parseFloat(tickerData.mark_price),
                    index_price: parseFloat(tickerData.index_price),
                    volume_24h: parseFloat(tickerData.volume_24h)
                });
            }
        }
    }
}

const gateFuturesWebsocket = new GateFuturesWebsocket();
export default gateFuturesWebsocket;
