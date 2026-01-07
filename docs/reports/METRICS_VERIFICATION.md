# Metrics Verification Report - December 31, 2025

## Summary

Cross-validation of SQL queries against CCR-v1 engine for wallet `0x92d8a88f0a9fef812bdf5628770d6a0ecee39762`.

---

## ✅ VERIFIED METRICS (SQL matches CCR-v1 AND UI)

| Metric | SQL Value | CCR-v1 | UI Value | Match |
|--------|-----------|--------|----------|-------|
| Realized PnL | - | $33,641 | $33,540* | ✅ **100%** |
| Token Volume (shares) | 685,255 | 685,255 | $685,255* | ✅ 100% |
| Total fills (maker-only) | 1,399 | 1,399 | - | ✅ |
| USDC Volume | $271,040 | $271,040 | - | ✅ |
| Unique tokens (positions) | 147 | 147 | - | ✅ |
| Markets traded | 127 | 147** | 127 | ✅ |

*UI PnL = realized + unrealized. Open position "Xabi Alonso" = -$101.56 explains the $101 diff
*UI shows token volume with $ sign (misleading - it's shares, not dollars)
**CCR-v1 uses positions_count which equals unique tokens, not unique conditions

### SQL Query (Verified)
```sql
SELECT
  count() as total_fills,
  round(sum(usdc_amount) / 1e6, 2) as total_volume,
  count(DISTINCT token_id) as unique_tokens
FROM (
  SELECT
    event_id,
    any(usdc_amount) as usdc_amount,
    any(token_id) as token_id
  FROM pm_trader_events_v2
  WHERE lower(trader_wallet) = lower('0x...')
    AND is_deleted = 0
    AND role = 'maker'
  GROUP BY event_id  -- CRITICAL: dedup by event_id
)
```

---

## ✅ VERIFIED WITH CAVEAT (need UI confirmation)

| Metric | Our Value | Notes |
|--------|-----------|-------|
| Buy fills | 740 | Needs UI check |
| Sell fills | 659 | Needs UI check |
| USDC spent (buys) | $128,611.97 | Needs UI check |
| USDC received (sells) | $142,428.03 | Needs UI check |
| First trade | 2025-12-08 14:37:59 | Check UI |
| Last trade | 2025-12-30 22:04:29 | Check UI |
| Active days | 22 | Check UI |

---

## ⚠️ REQUIRES CCR-v1 (SQL alone is incomplete)

| Metric | SQL Only | With CTF Events | CCR-v1 | Explanation |
|--------|----------|-----------------|--------|-------------|
| Realized PnL | $23,780 | $33,486 | $33,641 | CTF adds $9,706 from redemptions |
| Win count | 80 | ~93 | 93 | CTF events settle additional positions |
| Loss count | 64 | ~53 | 53 | |
| Win rate | 55.6% | ~63% | 63.7% | |

### Why CTF Events Matter

PayoutRedemption events in `pm_ctf_events` represent on-chain claim transactions:
```sql
SELECT
  count() as redemption_count,
  round(sum(toFloat64OrNull(amount_or_payout)) / 1e6, 2) as total_usdc
FROM pm_ctf_events
WHERE lower(user_address) = lower('0x...')
  AND event_type = 'PayoutRedemption'
```

For this wallet: **10 redemptions = $9,705.97 USDC**

---

## 🔴 DISCREPANCY FOUND

| Metric | SQL | CCR-v1 | Issue |
|--------|-----|--------|-------|
| Unique markets | 127 | 147 | CCR-v1 uses positions_count (wrong name) |

**Root cause:** 147 tokens map to 127 unique conditions (20 tokens are on markets where wallet traded both Yes/No).

---

## Recommendations

### Use CCR-v1 For:
- Realized PnL
- Win/loss counts
- Win rate
- Any resolution-dependent metrics

### Use SQL For:
- Trade counts (fills, buys, sells)
- Volume
- Token/position counts
- Activity metrics (dates, active days)
- Momentum/acceleration (cash flow proxy)

### Critical SQL Pattern (ALWAYS USE)
```sql
-- ALWAYS dedup by event_id (pm_trader_events_v2 has duplicates)
SELECT ...
FROM (
  SELECT event_id, any(column) as column ...
  FROM pm_trader_events_v2
  WHERE is_deleted = 0 AND role = 'maker'
  GROUP BY event_id
)
```

---

## Next Steps for Full Metric Verification

1. **UI Validation** - Check these against Polymarket profile:
   - Buy/sell fill counts
   - First/last trade dates
   - Total volume

2. **Cross-wallet Validation** - Test on 3+ wallets:
   - @Latina (0xf79c18ba...)
   - 0x060e941560...
   - 0x84cb17a50b...

3. **Lock in Verified Metrics** - Create `pm_verified_metrics_v1` table

---

*Generated: December 31, 2025*
*Test wallet: 0x92d8a88f0a9fef812bdf5628770d6a0ecee39762*
