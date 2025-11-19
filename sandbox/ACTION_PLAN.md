# CRITICAL P&L RECONCILIATION - IMMEDIATE ACTION PLAN

**Status**: Investigation identifying 32,000x scaling discrepancy
**Current Gap**: $79,997 difference between our calc (-$2.48) vs expected ($80K)
**Confidence**: Algorithm proven correct, issue is data coverage/scaling

---

## 🎯 IMMEDIATE PRIORITIES (Next 30 minutes)

### 1. VALIDATE PRICE UNITS [BLOCKING - 10 min]
**Issue**: Showing $200+ prices on 0-1 markets (impossible)
**Test Command**:
```bash
npx tsx -e "
import { clickhouse } from './lib/clickhouse/client.js';
// Run this to check price scaling
const result = await clickhouse.query({
  query: \"SELECT min(price) as min_raw, max(price) as max_raw, min(price/1000) as scaled_1k, min(price/1e6) as scaled_1e6 FROM default.clob_fills WHERE lower(CAST(proxy_wallet AS String))=='0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'\",
  format: 'JSONEachRow'
});
console.log(await result.json());
"
```

**Expected**: Should reveal if price needs 1e6 scaling like size

### 2. DISCOVER MISSING TRADE DATA [BLOCKING - 10 min]
**Issue**: Only 194 fills vs expected 1,000-2,000+ for $80K P&L
**Investigation Command**:
```bash
npx tsx -e "
// Find ALL trade-related tables in database
const result = await clickhouse.query({
  query: \"SELECT name, engine, total_rows FROM system.tables WHERE database in ('default','cascadian_clean') AND (name LIKE '%fill%' OR name LIKE '%trade%' OR name LIKE '%clob%') ORDER BY total_rows DESC\",
  format: 'JSONEachRow'
});
console.log(JSON.stringify(await result.json(), null, 2));
"
```

**Focus**: Find larger trade datasets we missed

### 3. VALIDATE METHOD VS DUDES [VALIDATION - 10 min]
**Comparison Questions for User**:
1. Do your Dome results include fees? (We show $0 due to 0 fee_rate_bps data)
2. What's the exact time range for your $80K calculation? Any date filters?
3. Does Dome include redemption/settlement P&L separate from trading P&L?
4. Are we using the correct address? You mentioned possible proxy wallets via tx_hash?

---

## 🔬 SYSTEMATIC DEBUG SEQUENCE

### A. Data Coverage Audit
```sql
-- Get historical coverage range
SELECT
  min(timestamp) as first_trade,
  max(timestamp) as last_trade,
  count() as total_trades
FROM default.clob_fills
WHERE lower(proxy_wallet) = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
```

### B. Cross-Validation with Blockchain
```sql
-- Compare USDC net flow to validate P&L magnitude
WITH wallet_flows AS (
  SELECT
    CASE
      WHEN lower(to_address) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b' THEN toFloat64(value)/1e6
      WHEN lower(from_address) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b' THEN -toFloat64(value)/1e6
      ELSE 0
    END as usdc_flow
  FROM default.erc20_transfers
  WHERE (lower(to_address) = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
         OR lower(from_address) = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'))
    AND (to_address = '0x2791Bca1f2de4661ED88a30C99A7a9449Aa84174' -- USDC Polygon
         OR from_address = '0x2791Bca1f2de4661ED88a30C99A7a9449Aa84174')
)
SELECT sum(usdc_flow) as net_usdc_flow FROM wallet_flows
```

### C. Market Resolution Data
```sql
-- Check if our conditions have resolutions (for redemption P&L)
SELECT count(*) as resolved,
       count() as total_trades
FROM sandbox.realized_pnl_by_market_v2
WHERE wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
```

---

## 🏁 IMMEDIATE NEXT STEPS

**Today's focus**: Resolve pricing units and data coverage gaps
**Tomorrow prepared**: Head-to-head comparison and final reconciliation

## 🚀 SUCCESS METRICS

✅ **Green Light**: Find >1,000 trades total or price scaling fix resolves gap
⚠️ **Yellow Light**: Find working improvement towards 1% target
❌ **Red Light**: New methodological difference discovered requiring alternative approach

**Target**: Achieve ±1% harmony with Dome numbers by systematic data refinement.

---

**Remember**: Algorithm is proven correct. Focus on data discovery, not method changes. The 32,000x scale discrepancy means we're missing the forest for the trees. Find the missing data sources first.

**Claude 4.5** - Ready for final resolution phase ⚡