const API_BASE = '/api';

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadExchangeInfo();

  // Show/hide Kelly options
  document.getElementById('sizing-method').addEventListener('change', (e) => {
    document.getElementById('kelly-options').classList.toggle('hidden', e.target.value !== 'kelly');
  });
});

async function loadSettings() {
  try {
    const [settingsRes, riskRes, sizingRes] = await Promise.all([
      axios.get(`${API_BASE}/settings`),
      axios.get(`${API_BASE}/risk-management`),
      axios.get(`${API_BASE}/position-sizing`)
    ]);

    const settings = settingsRes.data;
    const risk = riskRes.data;
    const sizing = sizingRes.data;

    // Trading settings
    document.getElementById('trading-pair').value = settings.trading_pair || 'BTC/USDT';
    document.getElementById('strategy').value = settings.strategy || 'Combined';
    document.getElementById('timeframe').value = settings.timeframe || '5m';
    document.getElementById('leverage').value = settings.leverage || 10;
    document.getElementById('position-size').value = settings.position_size || 100;
    document.getElementById('risk-percentage').value = settings.risk_percentage || 2;

    // Risk settings
    document.getElementById('auto-stop-loss').checked = risk.stopLossEnabled;
    document.getElementById('stop-loss-percent').value = risk.stopLossPercent || 2;
    document.getElementById('take-profit-percent').value = risk.takeProfitPercent || 4;
    document.getElementById('trailing-stop').checked = risk.trailingStopEnabled;
    document.getElementById('trailing-stop-percent').value = risk.trailingStopPercent || 1;
    document.getElementById('daily-loss-limit').value = risk.dailyLossLimit || 10;

    // Position sizing
    document.getElementById('sizing-method').value = sizing.settings?.method || 'fixed';
    document.getElementById('kelly-fraction').value = sizing.settings?.kellyFraction || 0.5;
    document.getElementById('kelly-options').classList.toggle('hidden', sizing.settings?.method !== 'kelly');

  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

async function loadExchangeInfo() {
  try {
    const response = await axios.get(`${API_BASE}/status`);
    const exchange = response.data.exchange;

    document.getElementById('exchange-name').textContent = exchange?.name || '--';
    document.getElementById('exchange-mode').textContent = exchange?.testnet ? 'Testnet' : 'Live';
    document.getElementById('exchange-status').textContent = exchange?.initialized ? 'Connected' : 'Disconnected';
    document.getElementById('exchange-rate-limit').textContent = `${exchange?.rateLimit || '--'} ms`;
  } catch (error) {
    console.error('Error loading exchange info:', error);
  }
}

async function saveTradingSettings() {
  const settings = {
    trading_pair: document.getElementById('trading-pair').value,
    strategy: document.getElementById('strategy').value,
    timeframe: document.getElementById('timeframe').value,
    leverage: document.getElementById('leverage').value,
    position_size: document.getElementById('position-size').value,
    risk_percentage: document.getElementById('risk-percentage').value
  };

  try {
    await axios.post(`${API_BASE}/settings`, settings);

    // Also update bot config
    await axios.post(`${API_BASE}/bot/config`, {
      symbol: settings.trading_pair,
      strategy: settings.strategy,
      timeframe: settings.timeframe,
      leverage: parseInt(settings.leverage),
      positionSize: parseFloat(settings.position_size)
    });

    showNotification('Trading settings saved', 'success');
  } catch (error) {
    showNotification(error.response?.data?.error || 'Failed to save settings', 'error');
  }
}

async function saveRiskSettings() {
  const settings = {
    stopLossEnabled: document.getElementById('auto-stop-loss').checked,
    stopLossPercent: parseFloat(document.getElementById('stop-loss-percent').value),
    takeProfitEnabled: true,
    takeProfitPercent: parseFloat(document.getElementById('take-profit-percent').value),
    trailingStopEnabled: document.getElementById('trailing-stop').checked,
    trailingStopPercent: parseFloat(document.getElementById('trailing-stop-percent').value),
    dailyLossLimit: parseFloat(document.getElementById('daily-loss-limit').value)
  };

  try {
    await axios.post(`${API_BASE}/risk-management`, settings);
    showNotification('Risk settings saved', 'success');
  } catch (error) {
    showNotification(error.response?.data?.error || 'Failed to save settings', 'error');
  }
}

async function savePositionSizing() {
  const settings = {
    method: document.getElementById('sizing-method').value,
    kellyFraction: parseFloat(document.getElementById('kelly-fraction').value)
  };

  try {
    await axios.post(`${API_BASE}/position-sizing`, settings);
    showNotification('Position sizing settings saved', 'success');
  } catch (error) {
    showNotification(error.response?.data?.error || 'Failed to save settings', 'error');
  }
}

function showNotification(message, type = 'info') {
  const colors = { success: 'bg-green-600', error: 'bg-red-600', info: 'bg-blue-600' };
  const notification = document.createElement('div');
  notification.className = `fixed bottom-4 right-4 ${colors[type]} px-6 py-3 rounded-lg shadow-lg z-50`;
  notification.textContent = message;
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 3000);
}
