# Smart Money Wallets - January 18, 2026

Generated from FIFO v4 (includes SHORT positions) | 30-day window | Validated against Polymarket API

---

## Copy-Worthy Wallets (Human-scale, Directional)

| Wallet | Trades | Win Rate | PnL | Notes |
|--------|--------|----------|-----|-------|
| `0x68469ab9009f2783e243a1d0957f4cdd8939b797` | 408 | 98.8% | +$380K | **VALIDATED** @jokerfucker |
| `0x5d89ad75f478bbcbc5cee98541288320d8eba2fe` | 129 | 58.1% | +$560K | Low trade count, big wins |
| `0x6211f97a76ed5c4b1d658f637041ac5f293db89e` | 35 | 80.0% | +$384K | Very selective |
| `0xe73ee729fc8ac69c3ee6ca70dedb3875070574fe` | 276 | 74.6% | +$415K | Good short exposure |
| `0xb889590a2fab0c810584a660518c4c020325a430` | 5,646 | 69.8% | +$891K | Consistent |

---

## Top Performers (High PnL, Realistic Win Rates)

| Wallet | Trades | Win Rate | PnL | Type |
|--------|--------|----------|-----|------|
| `0x16b29c50f2439faf627209b2ac0c7bbddaa8a881` | 35K | 53.2% | +$2.69M | Directional |
| `0xe90bec87d9ef430f27f9dcfe72c34b76967d5da2` | 15K | 54.2% | +$2.33M | Directional |
| `0xdb27bf2ac5d428a9c63dbc914611036855a6c56e` | 14K | 52.0% | +$2.31M | Directional |
| `0x1bc0d88ca86b9049cf05d642e634836d5ddf4429` | 6K | 66.8% | +$1.94M | Directional |
| `0x2005d16a84ceefa912d4e380cd32e7ff827875ea` | 208K | 51.7% | +$1.75M | High volume |

---

## Short Specialists (Profitable Betting Against Outcomes)

| Wallet | Short Trades | Short Win% | Short PnL | Long PnL |
|--------|--------------|------------|-----------|----------|
| `0x5350afcd8bd8ceffdf4da32420d6d31be0822fda` | 131 | 57.3% | +$899K | -$264K |
| `0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029` | 52 | 55.8% | +$892K | +$122K |
| `0x1bc0d88ca86b9049cf05d642e634836d5ddf4429` | 79 | 58.2% | +$805K | +$1.1M |
| `0xa49becb692927d455924583b5e3e5788246f4c40` | 277 | 71.8% | +$580K | -$32K |

---

## Watchlist (for copy trading signals)

```
0x68469ab9009f2783e243a1d0957f4cdd8939b797
0x1bc0d88ca86b9049cf05d642e634836d5ddf4429
0x5d89ad75f478bbcbc5cee98541288320d8eba2fe
0xb889590a2fab0c810584a660518c4c020325a430
0x8b5a7da2fdf239b51b9c68a2a1a35bb156d200f2
0x6211f97a76ed5c4b1d658f637041ac5f293db89e
0xe73ee729fc8ac69c3ee6ca70dedb3875070574fe
0x2cb0845f6a4900fbac0199bd6bae82daeab2d8b6
```

---

## Data Quality Notes

- **FIFO v4**: Tracks both LONG and SHORT positions (previous versions only tracked longs)
- **Validation**: Wallet `0x68469...` validated against Polymarket API with ~92% PnL match
- **Coverage**: Only includes RESOLVED markets - open positions not counted
- **Refresh**: Run `scripts/build-trade-fifo-v4-smart.ts` for newly resolved markets

---

## Red Flags to Watch

1. **Very high win rate + few trades** = possibly luck, not skill
2. **Huge trade count** = likely bots/market makers (different strategy)
3. **Low win rate + high PnL** = big bet strategy (high risk)
4. **High short %** = spread/arb trader (harder to copy)
