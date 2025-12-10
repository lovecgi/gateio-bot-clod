import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class Database {
  constructor() {
    const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/trading.db');
    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Database connection error:', err);
      } else {
        console.log('Connected to SQLite database');
        this.initialize();
      }
    });
  }

  initialize() {
    const tables = `
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        price REAL NOT NULL,
        leverage INTEGER,
        pnl REAL,
        fee REAL,
        status TEXT NOT NULL DEFAULT 'open',
        strategy TEXT,
        order_id TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL UNIQUE,
        side TEXT NOT NULL,
        amount REAL NOT NULL,
        entry_price REAL NOT NULL,
        leverage INTEGER NOT NULL,
        stop_loss REAL,
        take_profit REAL,
        trailing_stop REAL,
        unrealized_pnl REAL,
        realized_pnl REAL DEFAULT 0,
        opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME,
        status TEXT DEFAULT 'open'
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS daily_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        total_trades INTEGER DEFAULT 0,
        winning_trades INTEGER DEFAULT 0,
        losing_trades INTEGER DEFAULT 0,
        total_pnl REAL DEFAULT 0,
        max_drawdown REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS backtest_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        strategy TEXT NOT NULL,
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        start_date TEXT,
        end_date TEXT,
        initial_balance REAL,
        final_balance REAL,
        total_trades INTEGER,
        winning_trades INTEGER,
        losing_trades INTEGER,
        win_rate REAL,
        profit_factor REAL,
        max_drawdown REAL,
        sharpe_ratio REAL,
        parameters TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS advanced_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT,
        amount REAL,
        trigger_price REAL,
        limit_price REAL,
        stop_loss REAL,
        take_profit REAL,
        condition TEXT,
        status TEXT DEFAULT 'pending',
        parent_order_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        executed_at DATETIME,
        cancelled_at DATETIME
      );

      CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
      CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
      CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions(symbol);
      CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
    `;

    this.db.exec(tables, (err) => {
      if (err) {
        console.error('Error creating tables:', err);
      } else {
        console.log('Database tables initialized');
        this.initializeDefaultSettings();
      }
    });
  }

  initializeDefaultSettings() {
    const defaults = {
      'trading_pair': 'BTC/USDT',
      'leverage': '10',
      'position_size': '100',
      'risk_percentage': '2',
      'strategy': 'Combined',
      'timeframe': '5m',
      'auto_stop_loss': 'true',
      'stop_loss_percent': '2',
      'auto_take_profit': 'true',
      'take_profit_percent': '4',
      'trailing_stop': 'false',
      'trailing_stop_percent': '1',
      'daily_loss_limit': '10',
      'max_positions': '5',
      'position_sizing_method': 'fixed',
      'kelly_fraction': '0.5',
      'bot_running': 'false'
    };

    const stmt = this.db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
    for (const [key, value] of Object.entries(defaults)) {
      stmt.run(key, value);
    }
    stmt.finalize();
  }

  // Generic promisified query methods
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  // Trade methods
  async addTrade(trade) {
    const sql = `
      INSERT INTO trades (symbol, side, type, amount, price, leverage, pnl, fee, status, strategy, order_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    return this.run(sql, [
      trade.symbol,
      trade.side,
      trade.type,
      trade.amount,
      trade.price,
      trade.leverage,
      trade.pnl || null,
      trade.fee || null,
      trade.status || 'open',
      trade.strategy || null,
      trade.order_id || null
    ]);
  }

  async getTrades(limit = 100, offset = 0) {
    return this.all(
      `SELECT * FROM trades ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
  }

  async getTradesBySymbol(symbol, limit = 100) {
    return this.all(
      `SELECT * FROM trades WHERE symbol = ? ORDER BY timestamp DESC LIMIT ?`,
      [symbol, limit]
    );
  }

  async updateTrade(id, updates) {
    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    return this.run(
      `UPDATE trades SET ${fields} WHERE id = ?`,
      [...values, id]
    );
  }

  // Position methods
  async addPosition(position) {
    const sql = `
      INSERT INTO positions (symbol, side, amount, entry_price, leverage, stop_loss, take_profit, trailing_stop, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    return this.run(sql, [
      position.symbol,
      position.side,
      position.amount,
      position.entry_price,
      position.leverage,
      position.stop_loss || null,
      position.take_profit || null,
      position.trailing_stop || null,
      position.status || 'open'
    ]);
  }

  async getOpenPositions() {
    return this.all(`SELECT * FROM positions WHERE status = 'open'`);
  }

  async getPositionBySymbol(symbol) {
    return this.get(`SELECT * FROM positions WHERE symbol = ? AND status = 'open'`, [symbol]);
  }

  async updatePosition(symbol, updates) {
    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    return this.run(
      `UPDATE positions SET ${fields} WHERE symbol = ? AND status = 'open'`,
      [...values, symbol]
    );
  }

  async closePosition(symbol, pnl) {
    return this.run(
      `UPDATE positions SET status = 'closed', closed_at = CURRENT_TIMESTAMP, realized_pnl = ? WHERE symbol = ? AND status = 'open'`,
      [pnl, symbol]
    );
  }

  async deletePosition(symbol) {
    return this.run(`DELETE FROM positions WHERE symbol = ?`, [symbol]);
  }

  // Settings methods
  async getSetting(key) {
    const row = await this.get(`SELECT value FROM settings WHERE key = ?`, [key]);
    return row ? row.value : null;
  }

  async getSettings() {
    const rows = await this.all(`SELECT key, value FROM settings`);
    const settings = {};
    rows.forEach(row => {
      settings[row.key] = row.value;
    });
    return settings;
  }

  async setSetting(key, value) {
    return this.run(
      `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
      [key, value.toString()]
    );
  }

  async setSettings(settings) {
    for (const [key, value] of Object.entries(settings)) {
      await this.setSetting(key, value);
    }
  }

  // Daily stats methods
  async getDailyStats(date) {
    return this.get(`SELECT * FROM daily_stats WHERE date = ?`, [date]);
  }

  async updateDailyStats(date, stats) {
    const existing = await this.getDailyStats(date);
    if (existing) {
      const fields = Object.keys(stats).map(k => `${k} = ?`).join(', ');
      const values = Object.values(stats);
      return this.run(
        `UPDATE daily_stats SET ${fields} WHERE date = ?`,
        [...values, date]
      );
    } else {
      return this.run(
        `INSERT INTO daily_stats (date, total_trades, winning_trades, losing_trades, total_pnl, max_drawdown)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [date, stats.total_trades || 0, stats.winning_trades || 0, stats.losing_trades || 0, stats.total_pnl || 0, stats.max_drawdown || 0]
      );
    }
  }

  async getDailyStatsRange(startDate, endDate) {
    return this.all(
      `SELECT * FROM daily_stats WHERE date BETWEEN ? AND ? ORDER BY date ASC`,
      [startDate, endDate]
    );
  }

  // Analytics methods
  async getPerformanceStats() {
    const trades = await this.all(`SELECT * FROM trades WHERE status = 'closed' AND pnl IS NOT NULL`);

    if (trades.length === 0) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalPnl: 0,
        avgPnl: 0,
        maxWin: 0,
        maxLoss: 0,
        profitFactor: 0
      };
    }

    const winningTrades = trades.filter(t => t.pnl > 0);
    const losingTrades = trades.filter(t => t.pnl < 0);
    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));

    return {
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: (winningTrades.length / trades.length * 100).toFixed(2),
      totalPnl: totalPnl.toFixed(2),
      avgPnl: (totalPnl / trades.length).toFixed(2),
      maxWin: winningTrades.length > 0 ? Math.max(...winningTrades.map(t => t.pnl)).toFixed(2) : 0,
      maxLoss: losingTrades.length > 0 ? Math.min(...losingTrades.map(t => t.pnl)).toFixed(2) : 0,
      profitFactor: grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? 'Infinity' : 0
    };
  }

  async getDailyPnl(days = 30) {
    return this.all(`
      SELECT DATE(timestamp) as date, SUM(pnl) as daily_pnl, COUNT(*) as trades
      FROM trades
      WHERE pnl IS NOT NULL AND timestamp >= DATE('now', '-${days} days')
      GROUP BY DATE(timestamp)
      ORDER BY date ASC
    `);
  }

  async getCumulativePnl(days = 30) {
    const dailyPnl = await this.getDailyPnl(days);
    let cumulative = 0;
    return dailyPnl.map(day => {
      cumulative += day.daily_pnl;
      return { ...day, cumulative_pnl: cumulative };
    });
  }

  async getPerformanceByCoin() {
    return this.all(`
      SELECT symbol,
             COUNT(*) as total_trades,
             SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
             SUM(pnl) as total_pnl,
             AVG(pnl) as avg_pnl
      FROM trades
      WHERE pnl IS NOT NULL
      GROUP BY symbol
      ORDER BY total_pnl DESC
    `);
  }

  async getPerformanceByStrategy() {
    return this.all(`
      SELECT strategy,
             COUNT(*) as total_trades,
             SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
             SUM(pnl) as total_pnl,
             AVG(pnl) as avg_pnl
      FROM trades
      WHERE pnl IS NOT NULL AND strategy IS NOT NULL
      GROUP BY strategy
      ORDER BY total_pnl DESC
    `);
  }

  // Advanced orders methods
  async addAdvancedOrder(order) {
    const sql = `
      INSERT INTO advanced_orders (type, symbol, side, amount, trigger_price, limit_price, stop_loss, take_profit, condition, status, parent_order_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    return this.run(sql, [
      order.type,
      order.symbol,
      order.side || null,
      order.amount || null,
      order.trigger_price || null,
      order.limit_price || null,
      order.stop_loss || null,
      order.take_profit || null,
      order.condition || null,
      order.status || 'pending',
      order.parent_order_id || null
    ]);
  }

  async getAdvancedOrders(status = 'pending') {
    return this.all(`SELECT * FROM advanced_orders WHERE status = ? ORDER BY created_at DESC`, [status]);
  }

  async updateAdvancedOrder(id, updates) {
    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    return this.run(
      `UPDATE advanced_orders SET ${fields} WHERE id = ?`,
      [...values, id]
    );
  }

  async cancelAdvancedOrder(id) {
    return this.run(
      `UPDATE advanced_orders SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );
  }

  // Backtest results methods
  async saveBacktestResult(result) {
    const sql = `
      INSERT INTO backtest_results (strategy, symbol, timeframe, start_date, end_date, initial_balance, final_balance, total_trades, winning_trades, losing_trades, win_rate, profit_factor, max_drawdown, sharpe_ratio, parameters)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    return this.run(sql, [
      result.strategy,
      result.symbol,
      result.timeframe,
      result.start_date,
      result.end_date,
      result.initial_balance,
      result.final_balance,
      result.total_trades,
      result.winning_trades,
      result.losing_trades,
      result.win_rate,
      result.profit_factor,
      result.max_drawdown,
      result.sharpe_ratio,
      JSON.stringify(result.parameters || {})
    ]);
  }

  async getBacktestResults(limit = 50) {
    return this.all(
      `SELECT * FROM backtest_results ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
  }

  close() {
    this.db.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
      } else {
        console.log('Database connection closed');
      }
    });
  }
}

// Singleton instance
const database = new Database();

export default database;
