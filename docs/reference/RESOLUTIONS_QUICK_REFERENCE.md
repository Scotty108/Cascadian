# Unified Resolutions - Quick Reference Card

## One-Line Summary
Use `cascadian_clean.vw_resolutions_unified` for all resolution lookups - it has 144k markets with 100% complete payout vectors.

---

## Coverage at a Glance

| Metric | Value |
|--------|-------|
| Unique markets | 144,015 |
| Market coverage | 24.8% (56k/228k) |
| Volume coverage | 14.25% ($1.5B/$10.4B) |
| Payout completeness | 100% |

**Why low?** Most traded markets are unresolved (still active or expired).

---

## Basic Queries

### Get resolution
```sql
SELECT * FROM cascadian_clean.vw_resolutions_unified
WHERE cid_hex = lower('0x...')
```

### Calculate P&L
```sql
SELECT
  t.wallet_address,
  (t.shares * arrayElement(r.payout_numerators, r.winning_index + 1) / r.payout_denominator) - t.cost_basis as pnl
FROM vw_trades_canonical t
JOIN cascadian_clean.vw_resolutions_unified r ON lower(t.condition_id_norm) = r.cid_hex
```

**Remember:** ClickHouse arrays are 1-indexed, so use `winning_index + 1`

---

## Schema

```sql
cid_hex             String          -- 0x + 64 hex chars
winning_index       UInt16          -- 0-based index
payout_numerators   Array(UInt8)    -- Payout vector
payout_denominator  UInt8           -- Denominator
resolved_at         DateTime        -- Resolution time
winning_outcome     String          -- "Yes", "No", etc.
source              String          -- Always 'warehouse'
priority            UInt8           -- Always 1
```

---

## Migration Checklist

- [ ] Update `vw_trade_pnl`
- [ ] Update `vw_trade_pnl_final`
- [ ] Update `vw_wallet_pnl_simple`
- [ ] Update `vw_wallet_positions`
- [ ] Test P&L calculations
- [ ] Deprecate `vw_resolutions_all`

**Run:** `npx tsx update-pnl-views.ts`

---

## Common Issues

**Q: Why only 24.8% coverage?**
A: 63% of traded markets have resolutions (144k/228k). Of those, only 39% overlap with traded markets. This is expected.

**Q: Should I use `vw_resolutions_all`?**
A: No, use `vw_resolutions_unified` instead. It's the same data but deduplicated.

**Q: How do I join to trades?**
A: `ON lower(t.condition_id_norm) = r.cid_hex`

**Q: What about `market_resolutions_final`?**
A: Use `vw_resolutions_unified` instead - it's deduplicated and normalized.

---

## Files

- `RESOLUTIONS_UNIFIED_COMPLETE.md` - Full guide
- `verify-unified-resolutions.ts` - Verification script
- `update-pnl-views.ts` - Migration script

---

## Key Rule

**Always use `vw_resolutions_unified` for P&L calculations.**
It's the only source with complete payout vectors.
