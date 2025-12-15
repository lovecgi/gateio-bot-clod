# Gate.io Futures Trading Bot - JavaScript/Node.js

Gate.io Futures API의 WebSocket을 활용한 실시간 트레이딩 봇 (JavaScript/Node.js 버전)

## 🚀 빠른 시작

### 1. 설치

```bash
# 의존성 설치
npm install

# 또는
yarn install
```

### 2. 환경 변수 설정

`.env` 파일 생성:

```bash
cp .env.example .env
```

`.env` 파일 편집:

```env
GATE_API_KEY=your_api_key_here
GATE_API_SECRET=your_api_secret_here
```

### 3. 실행

```bash
# 스캘핑 전략
npm run scalping

# 브레이크아웃 전략
npm run breakout

# 그리드 트레이딩
npm run grid

# 커스텀 실행
node trading-bot.js scalping BTC_USDT ETH_USDT
```

---

## 📦 파일 구조

```
├── package.json                  # npm 설정
├── .env.example                  # 환경 변수 예제
├── gate-futures-rest.js          # REST API 클라이언트
├── gate-futures-websocket.js     # WebSocket 클라이언트
├── trailing-tp-manager.js        # Trailing TP 매니저
└── trading-bot.js                # 실전 트레이딩 봇
```

---

## 🎯 주요 기능

### 1. REST API 클라이언트

```javascript
import { GateFuturesREST } from './gate-futures-rest.js';

const client = new GateFuturesREST(apiKey, apiSecret);

// Order TP/SL
await client.createOrderWithTPSL(
    'BTC_USDT',
    10,        // size
    '50000',   // price
    true,      // isLong
    '52000',   // TP
    '49000'    // SL
);

// Entire Position TP/SL
await client.setEntirePositionTPSL('BTC_USDT', '52000', '49000');

// Partial Position TP/SL
await client.setPartialPositionTPSL('BTC_USDT', 5, '51000', '49500');

// Trailing TP
await client.createTrailingTP('BTC_USDT', 51000, 0.02, 10);
```

### 2. WebSocket 클라이언트

```javascript
import { GateFuturesWebSocket } from './gate-futures-websocket.js';

const ws = new GateFuturesWebSocket(apiKey, apiSecret);

// 연결
await ws.connect();

// Ticker 구독 (실시간 가격)
ws.subscribeTickers(['BTC_USDT', 'ETH_USDT']);

// 이벤트 리스너
ws.on('ticker', ({ contract, price }) => {
    console.log(`${contract}: $${price.toFixed(2)}`);
});

// Trades 구독
ws.subscribeTrades(['BTC_USDT']);

// OrderBook 구독
ws.subscribeOrderBook(['BTC_USDT'], '100ms', 20);

// Candlesticks 구독
ws.subscribeCandlesticks(['BTC_USDT'], '1m');
```

### 3. Trailing TP Manager

```javascript
import { TrailingTPManager } from './trailing-tp-manager.js';

const trailingManager = new TrailingTPManager(wsClient, restClient);

// Trailing TP 추가
trailingManager.addTrailingTP(
    'BTC_USDT',
    51000,    // 활성화 가격
    0.02,     // 2% 콜백
    10        // 수량
);

// 이벤트 리스너
trailingManager.on('trailing-activated', ({ contract, price }) => {
    console.log(`🚀 ${contract} Trailing 활성화 @ $${price}`);
});

trailingManager.on('trailing-updated', ({ contract, newTpPrice }) => {
    console.log(`📊 ${contract} TP 업데이트 → $${newTpPrice}`);
});

// 통계 출력
trailingManager.printStats();
```

### 4. 실전 트레이딩 봇

```javascript
import RealTimeTradingBot from './trading-bot.js';

const bot = new RealTimeTradingBot(apiKey, apiSecret);

// 스캘핑 전략
await bot.run(['BTC_USDT'], 'scalping');

// 브레이크아웃 전략
await bot.run(['BTC_USDT'], 'breakout');

// 그리드 트레이딩
await bot.run(['BTC_USDT'], 'grid');
```

---

## 💡 실전 예제

### 예제 1: 기본 Trailing TP

```javascript
import { GateFuturesWebSocket } from './gate-futures-websocket.js';
import { GateFuturesREST } from './gate-futures-rest.js';
import { TrailingTPManager } from './trailing-tp-manager.js';

async function main() {
    // 클라이언트 생성
    const ws = new GateFuturesWebSocket(
        process.env.GATE_API_KEY,
        process.env.GATE_API_SECRET
    );

    const rest = new GateFuturesREST(
        process.env.GATE_API_KEY,
        process.env.GATE_API_SECRET
    );

    // WebSocket 연결
    await ws.connect();

    // Trailing 매니저 생성
    const trailing = new TrailingTPManager(ws, rest);

    // Trailing TP 설정
    trailing.addTrailingTP('BTC_USDT', 51000, 0.02, 10);

    // 실시간 가격 구독
    ws.subscribeTickers(['BTC_USDT']);

    // 로그
    ws.on('ticker', ({ contract, price }) => {
        console.log(`[${new Date().toLocaleTimeString()}] ${contract}: $${price.toFixed(2)}`);
    });
}

main().catch(console.error);
```

### 예제 2: 멀티 계약 모니터링

```javascript
async function multiContractMonitoring() {
    const ws = new GateFuturesWebSocket();
    await ws.connect();

    const contracts = ['BTC_USDT', 'ETH_USDT', 'BNB_USDT'];

    // 각 계약마다 다른 처리
    const strategies = new Map();

    for (const contract of contracts) {
        strategies.set(contract, {
            entry: 0,
            tp: 0,
            sl: 0
        });
    }

    ws.on('ticker', ({ contract, price }) => {
        const strategy = strategies.get(contract);

        if (strategy) {
            // 전략 로직
            if (price >= strategy.tp) {
                console.log(`✅ ${contract} TP 도달!`);
            } else if (price <= strategy.sl) {
                console.log(`❌ ${contract} SL 도달!`);
            }
        }
    });

    ws.subscribeTickers(contracts);
}
```

### 예제 3: 스캘핑 봇

```javascript
class ScalpingBot {
    constructor(wsClient, restClient) {
        this.ws = wsClient;
        this.rest = restClient;
        this.positions = new Map();
    }

    async start(contract) {
        // 가격 모니터링
        this.ws.on('ticker', async ({ contract: c, price }) => {
            if (c !== contract) return;

            const position = this.positions.get(contract);

            if (!position) {
                // 진입
                await this.enter(contract, price);
            } else {
                // 청산 체크
                await this.checkExit(contract, price, position);
            }
        });

        this.ws.subscribeTickers([contract]);
    }

    async enter(contract, price) {
        const size = 10;
        const tp1 = price * 1.003;  // 0.3%
        const tp2 = price * 1.005;  // 0.5%
        const sl = price * 0.998;   // 0.2%

        this.positions.set(contract, {
            entry: price,
            tp1, tp2, sl
        });

        // TP/SL 설정
        await this.rest.setPartialPositionTPSL(contract, 5, tp1, sl);
        await this.rest.setPartialPositionTPSL(contract, 5, tp2, sl);

        console.log(`📊 진입: ${contract} @ $${price.toFixed(2)}`);
    }

    async checkExit(contract, price, position) {
        // TP/SL 체크
        if (price >= position.tp1) {
            console.log(`✅ TP1 체결!`);
        }
        if (price >= position.tp2) {
            console.log(`✅ TP2 체결!`);
            this.positions.delete(contract);
        }
        if (price <= position.sl) {
            console.log(`❌ SL 체결!`);
            this.positions.delete(contract);
        }
    }
}

// 사용
const bot = new ScalpingBot(wsClient, restClient);
await bot.start('BTC_USDT');
```

### 예제 4: 분할 익절

```javascript
async function multiLevelTakeProfit(contract, entryPrice, totalSize) {
    const rest = new GateFuturesREST(apiKey, apiSecret);

    // 3단계 분할 익절
    const levels = [
        { pct: 0.02, size: totalSize * 0.33 },  // 2%, 33%
        { pct: 0.04, size: totalSize * 0.33 },  // 4%, 33%
        { pct: 0.06, size: totalSize * 0.34 }   // 6%, 34%
    ];

    const sl = entryPrice * 0.98;  // 2% 손절

    for (const level of levels) {
        const tpPrice = entryPrice * (1 + level.pct);

        await rest.setPartialPositionTPSL(
            contract,
            Math.floor(level.size),
            tpPrice,
            sl
        );

        console.log(`TP 설정: ${level.size}개 @ $${tpPrice.toFixed(2)} (+${level.pct * 100}%)`);
    }
}

// 사용
await multiLevelTakeProfit('BTC_USDT', 50000, 30);
```

---

## 🎨 전략 구현

### 스캘핑 전략

```javascript
// 빠른 진입/청산
// 목표: 0.3-0.5%
// 손절: 0.2%

const bot = new RealTimeTradingBot(apiKey, apiSecret);
await bot.run(['BTC_USDT'], 'scalping');
```

**특징:**
- 고빈도 거래
- 작은 수익률
- 빠른 실행 (<1분)

### 브레이크아웃 전략

```javascript
// 저항선/지지선 돌파
// Trailing TP 자동 활성화

await bot.run(['BTC_USDT'], 'breakout');
```

**특징:**
- 트렌드 추종
- Trailing TP 사용
- 큰 수익 목표

### 그리드 트레이딩

```javascript
// 범위 거래
// 일정 간격으로 매수/매도

await bot.run(['BTC_USDT'], 'grid');
```

**특징:**
- 횡보 장세에 유리
- 자동 재진입
- 일정한 수익

---

## 📊 모니터링 및 로깅

### 실시간 가격 로그

```javascript
ws.on('ticker', ({ contract, price, data }) => {
    const timestamp = new Date().toLocaleTimeString();
    const change = parseFloat(data.change_percentage);

    console.log(
        `[${timestamp}] ${contract}: $${price.toFixed(2)} ` +
        `(${change > 0 ? '+' : ''}${change.toFixed(2)}%)`
    );
});
```

### 거래 통계

```javascript
class TradingStats {
    constructor() {
        this.trades = [];
        this.totalPnL = 0;
    }

    addTrade(entry, exit, size) {
        const pnl = ((exit - entry) / entry) * 100;

        this.trades.push({
            entry, exit, size, pnl,
            timestamp: new Date()
        });

        this.totalPnL += pnl;
    }

    print() {
        const wins = this.trades.filter(t => t.pnl > 0).length;
        const losses = this.trades.filter(t => t.pnl < 0).length;
        const winRate = (wins / this.trades.length) * 100;

        console.log('\n' + '='.repeat(60));
        console.log('📊 거래 통계');
        console.log('='.repeat(60));
        console.log(`총 거래: ${this.trades.length}`);
        console.log(`승: ${wins} | 패: ${losses}`);
        console.log(`승률: ${winRate.toFixed(1)}%`);
        console.log(`총 PnL: ${this.totalPnL.toFixed(2)}%`);
        console.log('='.repeat(60));
    }
}
```

---

## ⚡ 성능 최적화

### 1. 연결 풀링

```javascript
class ConnectionPool {
    constructor(size) {
        this.connections = [];
        this.size = size;
    }

    async init(apiKey, apiSecret) {
        for (let i = 0; i < this.size; i++) {
            const ws = new GateFuturesWebSocket(apiKey, apiSecret);
            await ws.connect();
            this.connections.push(ws);
        }
    }

    get() {
        return this.connections[
            Math.floor(Math.random() * this.connections.length)
        ];
    }
}
```

### 2. 이벤트 디바운싱

```javascript
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// 사용
const debouncedUpdate = debounce((price) => {
    updateTPOrder(price);
}, 1000); // 1초 대기
```

### 3. 에러 복구

```javascript
class ResilientWebSocket extends GateFuturesWebSocket {
    async connectWithRetry(maxRetries = 5) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                await this.connect();
                return;
            } catch (error) {
                const delay = Math.pow(2, i) * 1000;
                console.log(`재연결 시도 ${i + 1}/${maxRetries} (${delay}ms 후)`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw new Error('연결 실패');
    }
}
```

---

## 🔧 고급 설정

### 환경 변수 활용

```javascript
import dotenv from 'dotenv';

dotenv.config();

const config = {
    apiKey: process.env.GATE_API_KEY,
    apiSecret: process.env.GATE_API_SECRET,
    settle: process.env.SETTLE || 'usdt',
    defaultSize: parseInt(process.env.DEFAULT_SIZE) || 10,
    trailingCallback: parseFloat(process.env.TRAILING_CALLBACK) || 0.02
};
```

### 커스텀 전략

```javascript
class CustomStrategy {
    constructor(wsClient, restClient) {
        this.ws = wsClient;
        this.rest = restClient;
    }

    async start(contract) {
        // 커스텀 로직 구현
        this.ws.on('ticker', async ({ contract: c, price }) => {
            if (c !== contract) return;

            // 나만의 전략 로직
            await this.executeStrategy(price);
        });

        this.ws.subscribeTickers([contract]);
    }

    async executeStrategy(price) {
        // 전략 구현
    }
}
```

---

## 🚨 에러 처리

### Try-Catch 패턴

```javascript
async function safeExecute(func) {
    try {
        return await func();
    } catch (error) {
        console.error('실행 오류:', error.message);

        // 에러 유형별 처리
        if (error.response?.status === 429) {
            console.log('Rate limit 초과, 대기 중...');
            await new Promise(resolve => setTimeout(resolve, 60000));
        }

        return null;
    }
}

// 사용
const result = await safeExecute(() =>
    restClient.createOrderWithTPSL(...)
);
```

### 전역 에러 핸들러

```javascript
process.on('uncaughtException', (error) => {
    console.error('예외 발생:', error);
    // 로그 저장, 알림 발송 등
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Rejected Promise:', reason);
});
```

---

## 📚 참고 자료

- [Gate.io API 문서](https://www.gate.com/docs/developers/apiv4/en/)
- [WebSocket API](https://www.gate.com/docs/developers/apiv4/en/#websocket-api)
- [Node.js WebSocket](https://github.com/websockets/ws)

---

## ⚠️ 주의사항

1. **API 키 보안**: .env 파일을 git에 커밋하지 마세요
2. **Rate Limiting**: API 요청 제한을 준수하세요
3. **테스트**: 실제 자금 사용 전 충분히 테스트하세요
4. **리스크 관리**: 항상 손절을 설정하세요

---

## 📞 지원

문제가 발생하면 이슈를 등록해주세요.

**면책 조항**: 이 봇은 교육 목적으로 제공됩니다. 실제 거래로 인한 손실에 대해 책임지지 않습니다.
