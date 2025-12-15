import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRoutes from './routes/api.js';
import exchangeService from './services/exchange.js';
import { WebSocketServer } from 'ws';
import http from 'http';
import database from './models/database.js';
import gateFuturesWebsocket from './services/gate-futures-websocket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// API routes
app.use('/api', apiRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: process.env.NODE_ENV || 'development'
  });
});

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Catch-all for SPA routing
app.get(/.*/, (req, res) => {
  // Check if it's an API request that wasn't matched
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  // For all other routes, serve the main HTML file
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// WebSocket handling
wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket');

  ws.on('close', () => console.log('Client disconnected'));
});

// Broadcast Gate.io updates to all clients
gateFuturesWebsocket.on('ticker', (data) => {
  const message = JSON.stringify({ type: 'ticker_update', data });
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Initialize and start server
async function startServer() {
  try {
    console.log('Starting Crypto Trading Bot Server...');
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Exchange: ${process.env.EXCHANGE || 'gateio'}`);
    console.log(`Testnet: ${process.env.USE_TESTNET === 'true' ? 'Yes' : 'No'}`);

    // Initialize exchange connection
    try {
      await exchangeService.initialize();
      console.log('Exchange connection established');

      // Start Gate.io WebSocket
      gateFuturesWebsocket.connect();
      // Subscribe to default pair
      gateFuturesWebsocket.subscribeTickers([process.env.TRADING_PAIR || 'BTC/USDT']);

    } catch (error) {
      console.warn('Exchange initialization failed:', error.message);
      console.warn('Some features may not work until valid API credentials are provided');
    }

    // Start server
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log('Available endpoints:');
      console.log('  - Dashboard: http://localhost:' + PORT);
      console.log('  - API: http://localhost:' + PORT + '/api');
      console.log('  - Health: http://localhost:' + PORT + '/health');
    });

    // Graceful shutdown
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

async function gracefulShutdown() {
  console.log('\nShutting down gracefully...');

  try {
    // Import services dynamically to avoid circular dependencies
    const { default: tradingBot } = await import('./services/trading-bot.js');
    const { default: multiCoinBot } = await import('./services/multi-coin-bot.js');
    const { default: advancedOrdersService } = await import('./services/advanced-orders.js');

    // Stop bots
    if (tradingBot.isRunning) {
      await tradingBot.stop();
    }
    if (multiCoinBot.isRunning) {
      await multiCoinBot.stop(false); // Don't close positions on shutdown
    }

    // Stop order monitoring
    advancedOrdersService.stopMonitoring();

    // Close database
    database.close();

    console.log('Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

export default app;
