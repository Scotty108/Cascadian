# P&L Pipeline Rebuild - Implementation Plan

**Date**: 2025-11-11
**Terminal**: Claude 1
**Status**: PLANNING PHASE
**Estimated Duration**: 4-6 hours

---

## Executive Summary

**Goal**: Rebuild P&L calculation using complete blockchain data (ERC1155) instead of incomplete CLOB data.

**Problem**: CLOB fills (194 transactions) missing 55 blockchain transfers (22% of data), causing $52K P&L gap.

**Solution**: Hybrid approach using:
- **ERC1155** for position tracking (complete, 249 transactions)
- **CLOB** for price/cost basis (where available)
- **Settlement prices** for ERC1155-only trades

---

## Current State Analysis

### Data Sources

| Source | Transactions | Coverage | Has Prices | Has Positions |
|--------|-------------|----------|------------|---------------|
| `clob_fills` | 194 | 78% | ✅ Yes | ✅ Yes |
| `erc1155_transfers` | 249 | 100% | ❌ No | ✅ Yes |
| **Gap** | **55** | **22%** | - | - |

### Existing Tables

**Views to rebuild**:
1. `outcome_positions_v2` - Position tracking by (wallet, condition_id, outcome)
2. `trade_cashflows_v3` - Cost basis and cashflows
3. `realized_pnl_by_market_final` - Final P&L calculation

**Mapping tables** (keep as-is):
- `ctf_token_map` - Maps token_id → condition_id + outcome_index (139K entries)
- `winning_index` - Market resolutions
- `erc1155_condition_map` - Additional mapping table

**Source tables** (read-only):
- `erc1155_transfers` - Blockchain transfers (complete)
- `clob_fills` - CLOB fills (price data)

---

## Technical Architecture

### ERC1155 Data Structure

```sql
-- erc1155_transfers schema
tx_hash           String    -- Transaction hash
log_index         UInt32    -- Event log index
block_number      UInt64    -- Block number
block_timestamp   DateTime  -- When transaction occurred
contract          String    -- CTF contract address
token_id          String    -- ERC1155 token ID (maps to outcome)
from_address      String    -- Sender wallet
to_address        String    -- Receiver wallet
value             String    -- Token quantity (hex, needs conversion)
operator          String    -- Who executed the transfer
```

**Key insights**:
- ✅ 100% join success rate with `ctf_token_map`
- ✅ Can track all position changes
- ❌ No price/cost basis data
- ✅ 249 transfers for test wallet vs 194 CLOB

### Hybrid Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                    ERC1155 Transfers                    │
│               (Complete position tracking)              │
└─────────────────────┬───────────────────────────────────┘
                      │
                      │ JOIN ctf_token_map
                      ▼
┌─────────────────────────────────────────────────────────┐
│              Position Changes by Market                 │
│  (wallet, condition_id, outcome, net_shares_delta)      │
└─────────────────────┬───────────────────────────────────┘
                      │
                      │ AGGREGATE
                      ▼
┌─────────────────────────────────────────────────────────┐
│           outcome_positions_v2_blockchain               │
│      (wallet, condition_id, outcome, net_shares)        │
└─────────────────────┬───────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          │                       │
          ▼                       ▼
   ┌─────────────┐         ┌─────────────┐
   │ CLOB Fills  │         │  Fallback   │
   │ (if exists) │         │ (settlement │
   │ = cost basis│         │   price)    │
   └──────┬──────┘         └──────┬──────┘
          │                       │
          └───────────┬───────────┘
                      ▼
          ┌───────────────────────┐
          │ trade_cashflows_v3_   │
          │     blockchain        │
          └───────────┬───────────┘
                      │
                      ▼
          ┌───────────────────────┐
          │ realized_pnl_by_      │
          │   market_blockchain   │
          └───────────────────────┘
```

---

## Implementation Steps

### Phase 1: Backup & Safety (30 min)

**1.1 Create Backups**
```sql
-- Backup existing views
CREATE TABLE outcome_positions_v2_backup_20251111 AS
  SELECT * FROM outcome_positions_v2;

CREATE TABLE trade_cashflows_v3_backup_20251111 AS
  SELECT * FROM trade_cashflows_v3;

CREATE TABLE realized_pnl_by_market_final_backup_20251111 AS
  SELECT * FROM realized_pnl_by_market_final;
```

**1.2 Document Current State**
- Run validator query and save results
- Export per-market P&L to `tmp/pnl-before-rebuild.json`
- Save view definitions to `tmp/view-definitions-backup.sql`

**Rollback Plan**: If rebuild fails, restore from backups:
```sql
DROP VIEW IF EXISTS realized_pnl_by_market_final;
DROP VIEW IF EXISTS trade_cashflows_v3;
DROP VIEW IF EXISTS outcome_positions_v2;

CREATE VIEW outcome_positions_v2 AS
  SELECT * FROM outcome_positions_v2_backup_20251111;
-- (repeat for other views)
```

---

### Phase 2: Build ERC1155 Position Tracking (90 min)

**2.1 Create `outcome_positions_v2_blockchain` View**

```sql
CREATE OR REPLACE VIEW outcome_positions_v2_blockchain AS
WITH position_changes AS (
  SELECT
    CASE
      WHEN t.to_address != '0x0000000000000000000000000000000000000000'
        THEN lower(t.to_address)
      ELSE NULL
    END AS wallet_to,
    CASE
      WHEN t.from_address != '0x0000000000000000000000000000000000000000'
        THEN lower(t.from_address)
      ELSE NULL
    END AS wallet_from,
    ctm.condition_id_norm,
    ctm.outcome_index AS outcome_idx,
    -- Convert hex value to decimal and scale
    CAST(conv(t.value, 16, 10) AS Float64) AS shares
  FROM erc1155_transfers t
  INNER JOIN ctf_token_map ctm ON t.token_id = ctm.token_id
  WHERE t.to_address != t.from_address  -- Exclude self-transfers
),
position_deltas AS (
  -- Incoming transfers (positive)
  SELECT
    wallet_to AS wallet,
    condition_id_norm,
    outcome_idx,
    shares AS delta
  FROM position_changes
  WHERE wallet_to IS NOT NULL

  UNION ALL

  -- Outgoing transfers (negative)
  SELECT
    wallet_from AS wallet,
    condition_id_norm,
    outcome_idx,
    -shares AS delta
  FROM position_changes
  WHERE wallet_from IS NOT NULL
)
SELECT
  wallet,
  condition_id_norm,
  outcome_idx,
  sum(delta) / 1000000.0 AS net_shares  -- Scale from micro-shares
FROM position_deltas
GROUP BY wallet, condition_id_norm, outcome_idx
HAVING abs(net_shares) > 0.0001;  -- Filter dust positions
```

**2.2 Validate Position Tracking**

Test script: `scripts/validate-blockchain-positions.ts`

```typescript
// Compare position counts
const clobPositions = await clickhouse.query(`
  SELECT count(*) FROM outcome_positions_v2
  WHERE wallet = lower('0xcce2...')
`);

const blockchainPositions = await clickhouse.query(`
  SELECT count(*) FROM outcome_positions_v2_blockchain
  WHERE wallet = lower('0xcce2...')
`);

console.log(`CLOB positions: ${clobPositions}`);
console.log(`Blockchain positions: ${blockchainPositions}`);
console.log(`Additional: ${blockchainPositions - clobPositions}`);
```

**Expected**: Blockchain positions >= CLOB positions

---

### Phase 3: Build Cashflow Calculation (90 min)

**3.1 Create `trade_cashflows_v3_blockchain` View**

```sql
CREATE OR REPLACE VIEW trade_cashflows_v3_blockchain AS
WITH clob_cashflows AS (
  -- Use CLOB for trades we have price data for
  SELECT
    lower(cf.proxy_wallet) AS wallet,
    lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
    ctm.outcome_index AS outcome_idx,
    round(
      cf.price * (cf.size / 1000000.0) * if(cf.side = 'BUY', -1, 1),
      8
    ) AS cashflow_usdc
  FROM clob_fills cf
  INNER JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
  WHERE cf.condition_id IS NOT NULL
    AND cf.condition_id != ''
    AND cf.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
),
erc1155_only_trades AS (
  -- For ERC1155-only trades (no CLOB match)
  SELECT DISTINCT
    bp.wallet,
    bp.condition_id_norm,
    bp.outcome_idx
  FROM outcome_positions_v2_blockchain bp
  LEFT JOIN clob_cashflows cc
    ON cc.wallet = bp.wallet
    AND cc.condition_id_norm = bp.condition_id_norm
    AND cc.outcome_idx = bp.outcome_idx
  WHERE cc.wallet IS NULL
),
fallback_cashflows AS (
  -- Use settlement price for ERC1155-only trades
  -- Assume average entry at 0.5 (middle of 0-1 range)
  SELECT
    eot.wallet,
    eot.condition_id_norm,
    eot.outcome_idx,
    bp.net_shares * -0.5 AS cashflow_usdc
  FROM erc1155_only_trades eot
  INNER JOIN outcome_positions_v2_blockchain bp
    ON bp.wallet = eot.wallet
    AND bp.condition_id_norm = eot.condition_id_norm
    AND bp.outcome_idx = eot.outcome_idx
)
SELECT wallet, condition_id_norm, outcome_idx, cashflow_usdc FROM clob_cashflows
UNION ALL
SELECT wallet, condition_id_norm, outcome_idx, cashflow_usdc FROM fallback_cashflows;
```

**Note**: The fallback assumes 0.5 entry price. This is conservative and may underestimate P&L for ERC1155-only wins.

**3.2 Validate Cashflows**

Test script: `scripts/validate-blockchain-cashflows.ts`

```typescript
const wallet = '0xcce2...';

// Compare cashflow totals
const clobTotal = await clickhouse.query(`
  SELECT sum(cashflow_usdc) FROM trade_cashflows_v3
  WHERE wallet = lower('${wallet}')
`);

const blockchainTotal = await clickhouse.query(`
  SELECT sum(cashflow_usdc) FROM trade_cashflows_v3_blockchain
  WHERE wallet = lower('${wallet}')
`);

console.log(`CLOB cashflow: $${clobTotal}`);
console.log(`Blockchain cashflow: $${blockchainTotal}`);
console.log(`Difference: $${blockchainTotal - clobTotal}`);
```

---

### Phase 4: Rebuild P&L Calculation (60 min)

**4.1 Create `realized_pnl_by_market_blockchain` View**

```sql
CREATE OR REPLACE VIEW realized_pnl_by_market_blockchain AS
WITH cashflows_agg AS (
  SELECT
    wallet,
    condition_id_norm,
    outcome_idx,
    sum(cashflow_usdc) AS total_cashflow
  FROM trade_cashflows_v3_blockchain
  GROUP BY wallet, condition_id_norm, outcome_idx
)
SELECT
  p.wallet AS wallet,
  p.condition_id_norm AS condition_id_norm,
  wi.resolved_at AS resolved_at,
  round(
    coalesce(cf.total_cashflow, 0.0) + sumIf(p.net_shares, p.outcome_idx = wi.win_idx),
    4
  ) AS realized_pnl_usd
FROM outcome_positions_v2_blockchain AS p
LEFT JOIN winning_index AS wi ON wi.condition_id_norm = p.condition_id_norm
LEFT JOIN cashflows_agg AS cf
  ON cf.wallet = p.wallet
  AND cf.condition_id_norm = p.condition_id_norm
  AND cf.outcome_idx = p.outcome_idx
WHERE wi.win_idx IS NOT NULL
GROUP BY p.wallet, p.condition_id_norm, wi.resolved_at;
```

**4.2 Initial Validation**

Test script: `scripts/validate-blockchain-pnl.ts`

```typescript
const wallet = '0xcce2...';

const blockchainPnL = await clickhouse.query(`
  SELECT sum(realized_pnl_usd) as total
  FROM realized_pnl_by_market_blockchain
  WHERE wallet = lower('${wallet}')
`);

const total = blockchainPnL[0].total;
const dome = 87030.51;
const variance = Math.abs((total - dome) / dome * 100);

console.log(`Blockchain P&L: $${total}`);
console.log(`Dome baseline:  $${dome}`);
console.log(`Variance:       ${variance.toFixed(2)}%`);

if (variance < 2) {
  console.log(`✅ SUCCESS - <2% variance!`);
} else if (variance < 10) {
  console.log(`⚠️  Improved - needs tuning`);
} else {
  console.log(`❌ FAILED - investigate further`);
}
```

---

### Phase 5: Comprehensive Validation (90 min)

**5.1 Test All 14 Baseline Wallets**

Script: `scripts/validate-all-baselines.ts`

```typescript
const baselines = require('../tmp/dome-baseline-wallets.json');

for (const wallet of baselines) {
  const result = await clickhouse.query(`
    SELECT sum(realized_pnl_usd) as total
    FROM realized_pnl_by_market_blockchain
    WHERE wallet = lower('${wallet.address}')
  `);

  const variance = Math.abs((result[0].total - wallet.expected_pnl) / wallet.expected_pnl * 100);

  console.log(`${wallet.label}: ${variance.toFixed(2)}% variance`);
}
```

**5.2 Per-Market Comparison**

Export and compare per-market P&L:

```typescript
// Export blockchain-based per-market
const markets = await clickhouse.query(`
  SELECT condition_id_norm, sum(realized_pnl_usd) as pnl
  FROM realized_pnl_by_market_blockchain
  WHERE wallet = lower('${wallet}')
  GROUP BY condition_id_norm
`);

await fs.writeFile(
  'tmp/pnl-after-rebuild.json',
  JSON.stringify({ wallet, markets, total }, null, 2)
);
```

**5.3 Formula Verification**

Re-run the validator query from investigation using blockchain views:

```typescript
// Should match realized_pnl_by_market_blockchain exactly
const validatorQuery = `
  WITH positions AS (
    SELECT * FROM outcome_positions_v2_blockchain
    WHERE wallet = lower('${wallet}')
  ),
  cashflows AS (
    SELECT wallet, condition_id_norm, outcome_idx,
           sum(cashflow_usdc) as total_cashflow
    FROM trade_cashflows_v3_blockchain
    WHERE wallet = lower('${wallet}')
    GROUP BY wallet, condition_id_norm, outcome_idx
  )
  SELECT /* ... same as before ... */
`;
```

**Expected**: Validator = View (0 differences)

---

### Phase 6: Production Cutover (60 min)

**6.1 Rename Views (Atomic Swap)**

Only execute if Phase 5 validation passes (<2% variance):

```sql
-- Step 1: Rename current views to _old
ALTER TABLE outcome_positions_v2 RENAME TO outcome_positions_v2_old;
ALTER TABLE trade_cashflows_v3 RENAME TO trade_cashflows_v3_old;
ALTER TABLE realized_pnl_by_market_final RENAME TO realized_pnl_by_market_final_old;

-- Step 2: Rename blockchain views to production names
ALTER TABLE outcome_positions_v2_blockchain RENAME TO outcome_positions_v2;
ALTER TABLE trade_cashflows_v3_blockchain RENAME TO trade_cashflows_v3;
ALTER TABLE realized_pnl_by_market_blockchain RENAME TO realized_pnl_by_market_final;
```

**6.2 Test Production System**

```typescript
// Smoke test - verify UI still works
const leaderboard = await fetch('/api/wallets/top');
const wallet = await fetch('/api/wallets/0xcce2.../pnl');

// Verify expected values
assert(wallet.realized_pnl > 85000 && wallet.realized_pnl < 89000);
```

**6.3 Monitor**

- Check for errors in application logs
- Verify dashboard loads correctly
- Test all 14 baseline wallets via UI

---

## Validation Checkpoints

| Phase | Checkpoint | Pass Criteria | Rollback If |
|-------|-----------|---------------|-------------|
| 1 | Backups created | All tables backed up | N/A |
| 2 | Position count | Blockchain >= CLOB | Blockchain < CLOB |
| 3 | Cashflow totals | Reasonable (within 2x) | Cashflow = 0 or >10x |
| 4 | Initial P&L | <50% variance | >80% variance |
| 5 | All wallets | <10% avg variance | >25% avg variance |
| 5 | Test wallet | <2% variance | >5% variance |
| 6 | Production | No errors, UI loads | Any errors |

---

## Risk Assessment

### High Risk Items

1. **ERC1155-only pricing fallback**
   - **Risk**: Assuming 0.5 entry price may be inaccurate
   - **Mitigation**: Review actual ERC1155-only trades, adjust if needed
   - **Alternative**: Pull historical prices from external oracle

2. **Hex value conversion**
   - **Risk**: `value` field is hex string, needs correct parsing
   - **Mitigation**: Test on sample data first, verify conversions
   - **Validation**: Compare ERC1155 quantities with CLOB quantities where overlap exists

3. **Self-transfers**
   - **Risk**: May double-count if not excluded
   - **Mitigation**: Filter `WHERE to_address != from_address`

### Medium Risk Items

4. **Dust position threshold**
   - **Current**: `HAVING abs(net_shares) > 0.0001`
   - **Risk**: May still filter meaningful positions
   - **Mitigation**: Test without HAVING first, compare results

5. **Missing ctf_token_map entries**
   - **Risk**: Some ERC1155 transfers may not map to condition_ids
   - **Mitigation**: INNER JOIN will exclude unmapped transfers
   - **Validation**: Check unmapped count before rebuild

### Low Risk Items

6. **View dependencies**
   - **Risk**: Other queries/views depend on these views
   - **Mitigation**: Atomic rename preserves view names
   - **Validation**: Search codebase for references

---

## Rollback Strategy

### Quick Rollback (if Phase 4-5 fails)
```sql
-- Drop blockchain views
DROP VIEW IF EXISTS outcome_positions_v2_blockchain;
DROP VIEW IF EXISTS trade_cashflows_v3_blockchain;
DROP VIEW IF EXISTS realized_pnl_by_market_blockchain;

-- Nothing to restore - original views unchanged
```

### Full Rollback (if Phase 6 fails)
```sql
-- Step 1: Drop new production views
DROP VIEW IF EXISTS outcome_positions_v2;
DROP VIEW IF EXISTS trade_cashflows_v3;
DROP VIEW IF EXISTS realized_pnl_by_market_final;

-- Step 2: Restore old views
ALTER TABLE outcome_positions_v2_old RENAME TO outcome_positions_v2;
ALTER TABLE trade_cashflows_v3_old RENAME TO trade_cashflows_v3;
ALTER TABLE realized_pnl_by_market_final_old RENAME TO realized_pnl_by_market_final;
```

**Recovery Time**: <5 minutes

---

## Dependencies

### Required Tables (Must Exist)
- ✅ `erc1155_transfers`
- ✅ `ctf_token_map`
- ✅ `winning_index`
- ✅ `clob_fills`

### Optional Enhancements (Future)
- Price oracle integration (improve fallback pricing)
- Fee accounting (once fee data available)
- Unrealized P&L calculation

---

## Success Criteria

### Must Have (Go/No-Go)
- ✅ Test wallet (0xcce2...) variance <2% vs Dome
- ✅ All 14 baseline wallets <10% avg variance
- ✅ Formula verification: Validator = View
- ✅ No production errors
- ✅ UI functional

### Nice to Have
- ⭐ All 14 wallets <5% variance
- ⭐ Historical price oracle for better fallback
- ⭐ Fee integration

---

## Timeline Estimate

| Phase | Tasks | Duration | Dependencies |
|-------|-------|----------|--------------|
| 1 | Backup & Safety | 30 min | None |
| 2 | Position Tracking | 90 min | Phase 1 |
| 3 | Cashflow Calculation | 90 min | Phase 2 |
| 4 | P&L Rebuild | 60 min | Phase 3 |
| 5 | Validation | 90 min | Phase 4 |
| 6 | Production Cutover | 60 min | Phase 5 (must pass) |
| **Total** | | **6.5 hours** | |

**Buffer**: Add 1-2 hours for troubleshooting

---

## Next Steps

1. **Review this plan** - User approval required
2. **Create validation scripts** - Phases 2-5
3. **Execute Phase 1** - Backups
4. **Proceed sequentially** through Phases 2-6
5. **Document results** - Update reports with findings

---

## Open Questions

1. **ERC1155-only pricing**: Should we use 0.5 or pull historical prices?
2. **HAVING clause**: Keep 0.0001 threshold or remove entirely?
3. **Unmapped tokens**: How to handle ERC1155 transfers with no ctf_token_map entry?
4. **Validation threshold**: Is <2% test wallet + <10% avg sufficient for production?

---

**Terminal**: Claude 1
**Status**: PLANNING COMPLETE - Awaiting Approval
**Estimated Start**: Upon approval
**Estimated Completion**: 6-8 hours from start
