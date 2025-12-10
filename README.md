# Crypto Trading Bot

Gate.io 테스트넷을 사용하는 암호화폐 레버리지 선물 자동 거래 봇입니다.

## 주요 기능

- **멀티코인 동시 거래**: 여러 암호화폐를 동시에 자동 거래
- **기술적 분석 전략**: RSI, MACD, Bollinger Bands, Stochastic, Combined
- **자동 리스크 관리**: 손절/익절, 트레일링 스탑, 일일 손실 한도
- **자동 포지션 사이징**: Kelly Criterion, 변동성 기반 포지션 크기 계산
- **실시간 대시보드**: 웹 기반 UI로 모니터링 및 제어
- **백테스팅**: 과거 데이터로 전략 테스트 및 최적화

## 기술 스택

- **Backend**: Node.js, Express.js 5.x, SQLite3
- **Exchange API**: CCXT (Gate.io)
- **Frontend**: Tailwind CSS, Chart.js, Vanilla JS

## 설치

```bash
# 의존성 설치
npm install

# 환경 변수 설정
cp .env.example .env
# .env 파일을 편집하여 API 키 설정
```

## 실행

```bash
# 개발 모드
npm run dev

# 프로덕션 모드
npm start

# PM2로 실행
npm run pm2:start
```

## 환경 변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| EXCHANGE | 거래소 | gateio |
| API_KEY | API 키 | - |
| API_SECRET | API 시크릿 | - |
| USE_TESTNET | 테스트넷 사용 | true |
| TRADING_PAIR | 거래 쌍 | BTC/USDT |
| LEVERAGE | 레버리지 | 10 |
| POSITION_SIZE | 포지션 크기 (USD) | 100 |
| STRATEGY | 전략 | Combined |
| PORT | 서버 포트 | 3000 |

## API 엔드포인트

### 봇 제어
- `GET /api/status` - 봇 상태 조회
- `POST /api/start` - 봇 시작
- `POST /api/stop` - 봇 중지

### 멀티코인 봇
- `GET /api/multi-coin/status` - 멀티코인 봇 상태
- `POST /api/multi-coin/start` - 멀티코인 봇 시작
- `POST /api/multi-coin/add` - 코인 추가
- `DELETE /api/multi-coin/remove/:symbol` - 코인 제거

### 거래 & 포지션
- `GET /api/balance` - 잔고 조회
- `GET /api/positions` - 열린 포지션 조회
- `POST /api/positions/:symbol/close` - 포지션 청산
- `GET /api/trades` - 거래 내역

### 설정
- `GET /api/settings` - 설정 조회
- `POST /api/settings` - 설정 업데이트
- `POST /api/risk-management` - 리스크 관리 설정

### 분석
- `GET /api/performance` - 성과 통계
- `GET /api/analytics/daily-pnl` - 일별 손익
- `GET /api/analytics/cumulative-pnl` - 누적 손익

### 백테스팅
- `POST /api/backtest/run` - 백테스트 실행
- `POST /api/backtest/optimize` - 파라미터 최적화

## 거래 전략

1. **RSI**: 과매수(70+)/과매도(30-) 신호
2. **MACD**: MACD/Signal 크로스오버
3. **Bollinger Bands**: 밴드 터치 반전 신호
4. **Stochastic**: K/D 크로스오버
5. **Combined**: 모든 전략의 투표 시스템

## 리스크 관리

- 자동 손절/익절 설정
- 트레일링 스탑
- 일일 손실 한도
- 최대 포지션 수 제한
- Kelly Criterion 기반 포지션 사이징

## 라이선스

MIT License
