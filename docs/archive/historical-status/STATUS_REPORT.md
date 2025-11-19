# STATUS REPORT: Token Bridge Attempt

## What We Executed

Attempted to build a token_id → condition_id bridge using the formula:
- `token_id / 256 = condition_id`
- Source: `trades_raw_enriched_final` where condition_id LIKE 'token_%'

## Results

❌ **Token bridge approach FAILED**

### Numbers:
- **Bridge mappings created:** 17,340
- **Resolutions rekeyed:** 176 (out of 224,396)
- **Coverage:** 0% (0 / 227,838 traded markets)
- **Memory issues:** ClickHouse hitting 120GB limit on wallet queries

### Why It Failed:
1. **Limited data**: `trades_raw_enriched_final` only has 17K rows with `token_` format
2. **Wrong source**: The 176 rekeyed resolutions don't match ANY of our 227K traded markets
3. **Scale mismatch**: 176 resolutions vs 227K needed = 0.08% coverage

## Root Cause

The `token_` formatted condition_ids in `trades_raw_enriched_final` are:
- A small subset of data (17K out of millions of trades)
- From a different time period or data source
- Not representative of the main trading data

**The math was correct, but the data source was wrong.**

## What We DID Accomplish

✅ **PnL views updated** with NULL for unresolved (quick fix)
- This prevents false negative PnL
- But can't verify due to 0% coverage + memory issues

✅ **Database structure ready** for API backfill:
- `cascadian_clean.vw_resolutions_all` view exists
- `cascadian_clean.vw_wallet_positions` exists with correct logic
- `cascadian_clean.vw_wallet_metrics` exists

## Next Steps: API Backfill (Required)

Since the token bridge failed, we MUST do the API backfill:

### Plan:
1. **Export 227,838 unique condition_ids** from `fact_trades_clean`
2. **Query Polymarket API** for resolution data
   - Endpoint: `/markets/{condition_id}` or bulk endpoint
   - Fetch: `winning_index`, `payout_numerators`, `payout_denominator`
3. **Insert into new table** `cascadian_clean.resolutions_src_api`
4. **Update vw_resolutions_all** to include API source
5. **Verify coverage** should jump to 95%+

### Estimated Time:
- **Script development:** 1 hour
- **API execution:** 2-4 hours (depending on rate limits)
- **Verification:** 30 minutes
- **Total:** 3.5 - 5.5 hours

### Alternative: Use Existing Data

Before doing API backfill, we should check:
1. Does `gamma_markets` table have resolution data we can use?
2. Are there other resolution tables we haven't checked?
3. Can we derive resolutions from on-chain event data?

## Memory Issues

The large joins are hitting ClickHouse memory limits (120GB). This suggests:
- Need to optimize queries with better indexing
- May need to materialize intermediate tables
- Consider partitioning fact_trades_clean by date/range

## Recommendation

**Immediate next steps:**
1. Check `gamma_markets` for resolution data
2. If not sufficient, build API backfill script
3. Monitor memory usage and optimize if needed

**Do you want me to:**
- [ ] Check gamma_markets for resolution data?
- [ ] Build the API backfill script?
- [ ] Something else?
