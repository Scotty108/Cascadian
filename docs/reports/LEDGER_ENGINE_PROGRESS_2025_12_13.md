# Ledger PnL Engine Progress Report

**Date:** 2025-12-13
**Status:** BLOCKED by database query performance

---

## Key Findings

### 1. UI Includes Both Maker AND Taker Fills (CONFIRMED)

Tested 3 wallets with known UI "Volume traded" values:

| Wallet | UI Volume | Taker-Only | All Fills | Best Match |
|--------|-----------|------------|-----------|------------|
| Patapam222 | $6,158 | $4,857 (0.79x) | $5,889 (0.96x) | **ALL FILLS** |
| mnfgia | $7,916 | $644 (0.08x) | $8,533 (1.08x) | **ALL FILLS** |
| 0x88cee1fe | $2,553 | $1,328 (0.52x) | $1,415 (0.55x) | Neither* |

*Third wallet may have data completeness issues.

**Conclusion:** Do NOT filter to taker-only. Include all fills.

### 2. Trading-Only PnL Calculation is Fundamentally Wrong

For wallet Patapam222 (0xf70acdab):
- **UI shows:** $40.42 Net PnL
- **Trading-only engine shows:** $1,914.33

The 47x discrepancy is because the wallet is **short selling** via CTF token minting.

### 3. Root Cause: Short Selling / Token Minting

Trade analysis revealed negative share positions:

```
Token 5790463...: -260.66 shares remaining (SHORT)
Token 1096123...: -260.65 shares remaining (SHORT)
```

This happens when:
1. Wallet mints Yes+No token pairs ($1 per pair)
2. Wallet sells one side (e.g., 100 No for $60)
3. Wallet holds the other side (100 Yes)

Our trade data only captures step 2, missing:
- The $1 minting cost (CTF deposit)
- The final settlement/payout

### 4. Required Data Sources

To calculate correct PnL, we need:

| Source | Table | Status |
|--------|-------|--------|
| Trade fills | `pm_trader_events_v2` | ✅ Working |
| CTF deposits/payouts | `vw_pm_pnl_with_ctf` | ❌ Times out |
| Resolution prices | `pm_condition_resolutions` | ✅ Available |
| ERC1155 transfers | `pm_erc1155_transfers` | ⚠️ Slow/incomplete |

---

## Database Performance Issues

Queries to these views/tables timeout (>60s):
- `vw_pm_pnl_with_ctf` (per-wallet filter)
- `pm_unified_ledger_v4` (per-wallet filter)
- `pm_erc1155_transfers` (per-wallet filter)

These tables likely lack indexes on wallet columns.

---

## What We Built

### 1. Regression Test Fixture
`lib/pnl/__tests__/fixtures/ui-regression-wallets.json`
- 7 wallets with UI tooltip values
- Acceptance criteria: ±$5 small, ±$25 large, no sign flips

### 2. Ledger PnL Engine V1
`lib/pnl/engines/ledgerPnlEngineV1.ts`
- Avg-cost inventory tracking per token
- Trade processing (buy/sell)
- Transfer processing (with cost basis propagation)
- Settlement processing

### 3. Test Scripts
- `scripts/pnl/check-maker-inclusion.ts` - Confirmed maker fill inclusion
- `scripts/pnl/test-ledger-engine-v1.ts` - Regression test harness
- `scripts/pnl/analyze-wallet-trades.ts` - Trade flow analysis

---

## Next Steps

### Immediate (Unblocks Progress)
1. **Add wallet index to CTF views** - Required for per-wallet queries
2. **Or: Build pre-computed wallet PnL table** - Materialize `vw_pm_pnl_with_ctf` results

### Engine Enhancements
3. **Integrate CTF data** - Minting costs and settlement payouts
4. **Add resolution price lookup** - Convert condition_id → token_id
5. **Re-run regression tests** - Verify against UI values

---

## Technical Details

### Correct PnL Formula for Prediction Markets

For each position (wallet × condition × outcome):

```
realized_pnl = total_cash_flow + (final_shares × resolution_price)
```

Where:
- `total_cash_flow` = USDC received from sells - USDC spent on buys - CTF mint costs + CTF redemptions
- `final_shares` = net shares held (can be negative if short)
- `resolution_price` = 0 or 1 (losing vs winning outcome)

### Why Short Selling Breaks Simple Cash Flow

Simple formula: `sum(sells) - sum(buys)` = $1,914 (wrong)

This ignores:
1. **Minting cost:** Paid $1 per Yes+No pair to create short position
2. **Settlement obligation:** If short outcome wins, must pay $1 per share

Correct calculation requires CTF deposit/payout events.

---

**Report Generated:** 2025-12-13
**Blocker:** Database query performance on CTF views
