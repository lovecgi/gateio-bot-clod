// API Base URL
const API_BASE = '/api';

// State
let botStatus = null;
let refreshInterval = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  startAutoRefresh();
});

// Auto refresh every 5 seconds
function startAutoRefresh() {
  refreshInterval = setInterval(loadData, 5000);
}

// Load all data
async function loadData() {
  try {
    await Promise.all([
      loadStatus(),
      loadBalance(),
      loadPerformance(),
      loadTrades()
    ]);
  } catch (error) {
    console.error('Error loading data:', error);
  }
}

// Load bot status
async function loadStatus() {
  try {
    const response = await axios.get(`${API_BASE}/status`);
    botStatus = response.data;

    // Update UI
    const statusEl = document.getElementById('bot-status');
    const isRunning = botStatus.bot?.isRunning;

    statusEl.textContent = isRunning ? 'Running' : 'Stopped';
    statusEl.className = isRunning
      ? 'px-3 py-1 rounded-full text-sm bg-green-500/20 text-green-400'
      : 'px-3 py-1 rounded-full text-sm bg-red-500/20 text-red-400';

    document.getElementById('bot-strategy').textContent = botStatus.bot?.config?.strategy || '--';
    document.getElementById('symbol-label').textContent = botStatus.bot?.config?.symbol || 'BTC/USDT';

    // Load current price
    const symbol = botStatus.bot?.config?.symbol || 'BTC/USDT';
    loadTicker(symbol);

    // Update position
    updatePosition(botStatus.bot?.position);

  } catch (error) {
    console.error('Error loading status:', error);
  }
}

// Load balance
async function loadBalance() {
  try {
    const response = await axios.get(`${API_BASE}/balance`);
    const balance = response.data;

    document.getElementById('balance').textContent =
      `$${parseFloat(balance.USDT?.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } catch (error) {
    document.getElementById('balance').textContent = '--';
  }
}

// Load ticker
async function loadTicker(symbol) {
  try {
    const formattedSymbol = symbol.replace('/', '-');
    const response = await axios.get(`${API_BASE}/ticker/${formattedSymbol}`);
    const ticker = response.data;

    document.getElementById('current-price').textContent =
      `$${parseFloat(ticker.last).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } catch (error) {
    document.getElementById('current-price').textContent = '--';
  }
}

// Load performance stats
async function loadPerformance() {
  try {
    const response = await axios.get(`${API_BASE}/performance`);
    const stats = response.data;

    const totalPnl = parseFloat(stats.totalPnl) || 0;
    const pnlEl = document.getElementById('total-pnl');
    pnlEl.textContent = `$${totalPnl.toFixed(2)}`;
    pnlEl.className = `text-2xl font-bold mt-1 ${totalPnl >= 0 ? 'profit' : 'loss'}`;

    document.getElementById('win-rate').textContent = `${stats.winRate || 0}%`;
  } catch (error) {
    document.getElementById('total-pnl').textContent = '--';
    document.getElementById('win-rate').textContent = '--';
  }
}

// Load recent trades
async function loadTrades() {
  try {
    const response = await axios.get(`${API_BASE}/trades?limit=10`);
    const trades = response.data;

    const tbody = document.getElementById('trades-table');

    if (trades.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center py-8 text-gray-400">No trades yet</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = trades.map(trade => {
      const pnl = parseFloat(trade.pnl) || 0;
      const pnlClass = pnl >= 0 ? 'profit' : 'loss';
      const sideClass = trade.side === 'buy' ? 'text-green-400' : 'text-red-400';

      return `
        <tr class="border-t border-gray-700">
          <td class="py-3 text-sm">${formatDate(trade.timestamp)}</td>
          <td class="py-3">${trade.symbol}</td>
          <td class="py-3 ${sideClass} uppercase font-semibold">${trade.side}</td>
          <td class="py-3">${parseFloat(trade.amount).toFixed(4)}</td>
          <td class="py-3">$${parseFloat(trade.price).toLocaleString()}</td>
          <td class="py-3 ${pnlClass}">${pnl !== 0 ? (pnl > 0 ? '+' : '') + pnl.toFixed(2) : '-'}</td>
          <td class="py-3 text-sm text-gray-400">${trade.strategy || '-'}</td>
        </tr>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading trades:', error);
  }
}

// Update position display
function updatePosition(position) {
  const noPosition = document.getElementById('no-position');
  const positionDetails = document.getElementById('position-details');

  if (!position) {
    noPosition.classList.remove('hidden');
    positionDetails.classList.add('hidden');
    return;
  }

  noPosition.classList.add('hidden');
  positionDetails.classList.remove('hidden');

  const sideEl = document.getElementById('position-side');
  sideEl.textContent = position.side.toUpperCase();
  sideEl.className = `text-lg font-semibold ${position.side === 'long' ? 'text-green-400' : 'text-red-400'}`;

  document.getElementById('position-entry').textContent = `$${parseFloat(position.entryPrice).toLocaleString()}`;
  document.getElementById('position-amount').textContent = parseFloat(position.amount).toFixed(4);

  const pnl = parseFloat(position.unrealizedPnl) || 0;
  const pnlEl = document.getElementById('position-pnl');
  pnlEl.textContent = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
  pnlEl.className = `text-lg font-semibold ${pnl >= 0 ? 'profit' : 'loss'}`;
}

// Start bot
async function startBot() {
  try {
    const response = await axios.post(`${API_BASE}/start`);
    if (response.data.success) {
      showNotification('Bot started successfully', 'success');
      loadStatus();
    } else {
      showNotification(response.data.message || 'Failed to start bot', 'error');
    }
  } catch (error) {
    showNotification(error.response?.data?.error || 'Error starting bot', 'error');
  }
}

// Stop bot
async function stopBot() {
  try {
    const response = await axios.post(`${API_BASE}/stop`);
    if (response.data.success) {
      showNotification('Bot stopped', 'success');
      loadStatus();
    } else {
      showNotification(response.data.message || 'Failed to stop bot', 'error');
    }
  } catch (error) {
    showNotification(error.response?.data?.error || 'Error stopping bot', 'error');
  }
}

// Close position
async function closePosition() {
  if (!botStatus?.bot?.config?.symbol) return;

  const symbol = botStatus.bot.config.symbol.replace('/', '-');

  try {
    const response = await axios.post(`${API_BASE}/positions/${symbol}/close`);
    if (response.data.success) {
      showNotification(`Position closed. PnL: $${response.data.pnl?.toFixed(2) || 0}`, 'success');
      loadStatus();
    } else {
      showNotification(response.data.message || 'Failed to close position', 'error');
    }
  } catch (error) {
    showNotification(error.response?.data?.error || 'Error closing position', 'error');
  }
}

// Format date
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Show notification
function showNotification(message, type = 'info') {
  const colors = {
    success: 'bg-green-600',
    error: 'bg-red-600',
    info: 'bg-blue-600'
  };

  const notification = document.createElement('div');
  notification.className = `fixed bottom-4 right-4 ${colors[type]} px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in`;
  notification.textContent = message;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}
