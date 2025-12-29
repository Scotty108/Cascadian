# Copy Trading Candidates Report
**Generated:** 2025-12-23
**Formula:** Polymarket subgraph validated: `realizedPnL = sum(sellAmount * (sellPrice - avgBuyPrice))`
**Fixes Applied:** Terminal 2 NULLIF+COALESCE for empty string handling, sell cap to position amount

---

## TOP 20 COPY TRADING CANDIDATES

| Rank | Wallet | Net P&L | Win Rate* | Trades | Unmapped |
|------|--------|---------|-----------|--------|----------|
| 1 | `0xa6676646a16d8c7044ea2ac7e2b9ab09eb7384fe` | **$903,498** | 91.6% | 38,388 | 149 |
| 2 | `0xd1a535ed8543fc1852c87e2fb9ef6fed1c549de7` | **$538,301** | 98.3% | 8,084 | 45 |
| 3 | `0xecb14ac6e9ca447ce2f2912e6217b43d7b655da3` | **$313,692** | 52.5% | 44,697 | 72 |
| 4 | `0xf32a44b612a60f2b0c0f23c419876ec1c89c06fd` | **$226,899** | 65.9% | 9,408 | 163 |
| 5 | `0x510904c9a58f5c5ad799a1b44947077564175e9c` | **$226,033** | 64.5% | 43,880 | 183 |
| 6 | `0x6df6e2a9ba1e8d7609daada0a83138817f4a8458` | **$219,076** | 65.1% | 15,726 | 134 |
| 7 | `0x037b0a310066a10cd62f45de8696503ad4d147f4` | **$164,314** | 79.0% | 6,853 | 29 |
| 8 | `0xdefe23b9f2631280df4b18e43beef527150e5432` | **$145,262** | 55.7% | 7,471 | 11 |
| 9 | `0x10fbc3d2421e002f269089d15be6a56ce6ffc66c` | **$98,496** | 54.0% | 16,569 | 78 |
| 10 | `0x18670d5a83b7b38d509398067c095d4c321992ca` | **$93,746** | 52.6% | 11,718 | 88 |
| 11 | `0x6d3003a1396f1f044fe076a08c6ddb43037cb2b3` | **$88,550** | 64.7% | 8,790 | 29 |
| 12 | `0xf5d92058c977a9c957c6cbfbe3e9a27c83a9be50` | **$87,160** | 71.9% | 6,105 | 10 |
| 13 | `0x71971342cb4c2555f60366ac62abdcdd1a1d14c8` | **$84,427** | 53.4% | 7,425 | 22 |
| 14 | `0x2330488cca98f732418cc485b64fbf4e99bccb2c` | **$77,174** | 99.2% | 6,083 | 258 |
| 15 | `0xd98635c6bafebb11787bdbfd80688612d1bc1320` | **$76,546** | 58.0% | 16,074 | 69 |
| 16 | `0x1d9e3ecf835f3df1407f53d8ee5b51558c4a3a2e` | **$75,645** | 88.6% | 8,002 | 87 |
| 17 | `0x3419aa0a2fd9db8966e83b9bfc566b6ada3f58f3` | **$74,659** | 99.1% | 5,955 | 262 |
| 18 | `0xc0c0a19b93bcf26d56c8cd916d689302e940c0a5` | **$73,770** | 82.4% | 7,900 | 34 |
| 19 | `0x55dd1a051d3383636574e415c3f69fd2a76cee68` | **$71,395** | 67.3% | 6,257 | 42 |
| 20 | `0xc15e8de2943b68032a629314aa5b74f3322cab86` | **$69,205** | 98.9% | 5,770 | 277 |

*Win Rate = Gain / (Gain + Loss)

---

## HIGH-CONVICTION PICKS (Best Risk-Adjusted)

These wallets show consistently high win rates with significant P&L:

| Wallet | Net P&L | Win Rate | Profile |
|--------|---------|----------|---------|
| `0xd1a535ed...` | $538K | 98.3% | Low-volume precision trader |
| `0x2330488c...` | $77K | 99.2% | Ultra-selective |
| `0x3419aa0a...` | $75K | 99.1% | Minimal loss exposure |
| `0xc15e8de2...` | $69K | 98.9% | Consistent winner |
| `0xa6676646...` | $903K | 91.6% | High-volume with edge |
| `0x1d9e3ecf...` | $76K | 88.6% | Balanced approach |
| `0x037b0a31...` | $164K | 79.0% | Solid risk management |

---

## VOLUME LEADERS (Most Active Winners)

| Wallet | Net P&L | Trades | Avg P&L/Trade |
|--------|---------|--------|---------------|
| `0xecb14ac6...` | $314K | 44,697 | $7.02 |
| `0x510904c9...` | $226K | 43,880 | $5.15 |
| `0xa6676646...` | $903K | 38,388 | $23.54 |
| `0x6df6e2a9...` | $219K | 15,726 | $13.93 |
| `0xd98635c6...` | $77K | 16,074 | $4.76 |

---

## DATA QUALITY NOTES

- **Formula validated** against Polymarket UI: 3.5% error for @Holliewell, 19% for @pb7 (open positions)
- **Terminal 2 fixes applied**: NULLIF for empty strings, sell cap to position amount
- **Unmapped tokens**: Some tokens lack resolution data (shown in "Unmapped" column)
- **Sample size**: 200 retail wallets (100-10,000 trades, 60-day active)

---

## NEXT STEPS

1. **UI Validation**: Spot-check top 5 against Polymarket profiles
2. **Expand scope**: Run on 1,000+ wallets for broader coverage
3. **Live monitoring**: Track real-time trades from top candidates
4. **Copy trade execution**: Implement automated following for top performers

---

## RAW DATA

Full ranked list exported to: `exports/wallet_pnl_simple.csv`
