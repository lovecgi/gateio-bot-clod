import 'dotenv/config';
import tradingBot from '../services/trading-bot.js';
import database from '../models/database.js';

async function runScalpingBot() {
    try {
        console.log('Starting Scalping Bot...');

        // Force Bollinger Bands strategy for scalping configuration
        // You can also use 'Stochastic' or 'RSI' depending on preference
        // Bollinger is commonly used for scalping mean reversion
        const scalpingConfig = {
            strategy: 'Bollinger',
            timeframe: '1m', // Faster timeframe for scalping
            leverage: 5,     // Lower leverage for safety in automation
        };

        console.log('Applying Scalping Configuration:', scalpingConfig);
        await tradingBot.updateConfig(scalpingConfig);

        const result = await tradingBot.start();

        if (result.success) {
            console.log('Scalping Bot Running Successfully!');
            console.log('Press Ctrl+C to stop.');
        } else {
            console.error('Failed to start bot:', result.message);
            process.exit(1);
        }

        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\nStopping bot...');
            await tradingBot.stop();
            database.close();
            process.exit(0);
        });

    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

runScalpingBot();
