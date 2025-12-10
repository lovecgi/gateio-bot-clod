module.exports = {
  apps: [
    {
      name: 'crypto-trading-bot',
      script: 'src/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      log_file: 'logs/combined.log',
      time: true,
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 10000,
      // Restart policies
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      restart_delay: 1000
    }
  ]
};
