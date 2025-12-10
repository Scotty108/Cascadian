# V6 PnL Engine Implementation Plan

**Date:** 2025-11-29
**Goal:** Improve sign accuracy from 77.6% → 85%+, reduce median error from 24% → <15%
**Root Cause:** NegRisk conversions not tracked with proper cost basis

---

## Executive Summary

The investigation revealed that the two worst sign-mismatch wallets (showing -$282K and -$73K vs UI +$332K and +$360K) have massive token gaps: they sell 10-30x more tokens than they buy on CLOB. The missing tokens come from **NegRisk conversions** which we see in ERC1155 transfers but don't assign cost basis to.

**V6 Strategy:** Add synthetic BUY events with $0.50 cost basis for tokens received from NegRisk contracts.

---

## Phase 1: Build NegRisk Conversion View (Day 1)

### Step 1.1: Create ClickHouse View

```sql
CREATE VIEW vw_negrisk_conversions AS
SELECT
    lower(to_address) as wallet,
    tx_hash,
    block_number,
    -- Convert hex token_id to decimal
    toString(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3))))) as token_id_dec,
    -- Convert hex value to tokens
    reinterpretAsUInt64(reverse(unhex(substring(value, 3)))) / 1e6 as shares,
    -- Standard cost basis for NegRisk conversions
    0.50 as cost_basis_per_share,
    block_time
FROM pm_erc1155_transfers
WHERE lower(from_address) IN (
    '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296',  -- NegRisk Adapter
    '0xc5d563a36ae78145c45a50134d48a1215220f80a'   -- NegRisk CTF
)
AND startsWith(value, '0x')
AND length(value) > 2
```

### Step 1.2: Validate View

```sql
-- Test on worst wallet
SELECT
    count() as conversion_events,
    sum(shares) as total_tokens_acquired,
    sum(shares * cost_basis_per_share) as implied_cost_basis
FROM vw_negrisk_conversions
WHERE wallet = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
```

Expected: ~25K events, ~16M tokens, ~$8M implied cost basis

---

## Phase 2: Patch Engine (Day 1-2)

### Step 2.1: Copy V3 → V6

```bash
cp lib/pnl/uiActivityEngineV3.ts lib/pnl/uiActivityEngineV6.ts
```

### Step 2.2: Add NegRisk Event Loader

In `uiActivityEngineV6.ts`, add function:

```typescript
interface NegRiskAcquisition {
  wallet: string;
  token_id: string;
  shares: number;
  cost_basis: number;
  block_time: Date;
}

async function loadNegRiskAcquisitions(wallet: string): Promise<NegRiskAcquisition[]> {
  const query = `
    SELECT
      wallet,
      token_id_dec as token_id,
      shares,
      cost_basis_per_share as cost_basis,
      block_time
    FROM vw_negrisk_conversions
    WHERE wallet = '${wallet.toLowerCase()}'
    ORDER BY block_time ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return result.json();
}
```

### Step 2.3: Integrate into Event Stream

Before processing CLOB events, merge NegRisk acquisitions as synthetic BUY events:

```typescript
// In computeWalletActivityPnlV6()
const clobEvents = await loadClobEvents(wallet);
const negRiskAcquisitions = await loadNegRiskAcquisitions(wallet);

// Convert NegRisk acquisitions to synthetic BUY events
const syntheticBuys = negRiskAcquisitions.map(nr => ({
  event_type: 'NEGRISK_ACQUISITION',
  token_id: nr.token_id,
  side: 'buy',
  qty_tokens: nr.shares,
  usdc_amount: nr.shares * nr.cost_basis,
  trade_time: nr.block_time,
  // Flag to distinguish from real CLOB trades
  is_synthetic: true
}));

// Merge and sort all events chronologically
const allEvents = [...clobEvents, ...syntheticBuys].sort(
  (a, b) => a.trade_time.getTime() - b.trade_time.getTime()
);
```

### Step 2.4: Process Events

The existing average cost logic should work, just need to ensure:
- Synthetic buys add to position with cost basis
- Sells reduce position and realize PnL based on average cost

---

## Phase 3: Validation (Day 2-3)

### Step 3.1: Create Validation Script

```bash
# Copy existing validation script
cp scripts/pnl/comprehensive-v3-v5-validation.ts scripts/pnl/comprehensive-v3-v6-validation.ts
```

Update to compare V3 vs V6.

### Step 3.2: Key Metrics to Report

| Metric | V3 Baseline | V6 Target |
|--------|-------------|-----------|
| Sign Accuracy | 77.6% | 85%+ |
| Median Error | 24% | <15% |
| Mean Error | 48.6% | <30% |

### Step 3.3: Focus Wallets

Priority validation on these wallets:

| Wallet | UI PnL | V3 PnL | Issue |
|--------|--------|--------|-------|
| 0x4ce73141... | +$332K | -$282K | Sign wrong, 25K NegRisk events |
| 0x8e9eedf2... | +$360K | -$73K | Sign wrong, 3.5K NegRisk events |
| 0x12d6ccc... | +$150K | $0 | No data (investigate separately) |

---

## Phase 4: Iterate Cost Basis (Day 3)

If $0.50 doesn't produce accurate results, try:

| Cost Basis | Rationale |
|------------|-----------|
| $0.50 | Standard Polymarket split price |
| $0.00 | Conservative (free acquisition) |
| Market price | Complex: lookup price at conversion time |

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `lib/pnl/uiActivityEngineV6.ts` | CREATE | New engine with NegRisk |
| `scripts/pnl/create-vw-negrisk-conversions.ts` | CREATE | Create ClickHouse view |
| `scripts/pnl/comprehensive-v3-v6-validation.ts` | CREATE | Validation script |
| `docs/systems/pnl/V6_PNL_ENGINE_ACCURACY_REPORT.md` | CREATE | Results doc |

---

## Success Criteria

| Criteria | Threshold | Current |
|----------|-----------|---------|
| Sign accuracy | ≥85% | 77.6% |
| Median error | ≤15% | 24% |
| Worst wallet sign match | Both correct | Both wrong |
| Zero regression | No wallet gets worse by >5pp | N/A |

---

## Risk Mitigation

### Risk 1: Double-counting with CLOB trades

**Mitigation:** Exclude Exchange contract (0x4bfb41d5...) from NegRisk sources since those transfers are paired with CLOB fills.

### Risk 2: Token ID format mismatch

**Mitigation:** Verify token_id conversion formula matches pm_token_to_condition_map_v3 format.

### Risk 3: Timing issues

**Mitigation:** Sort ALL events chronologically before processing to ensure correct average cost updates.

---

## Implementation Checklist

- [ ] Create vw_negrisk_conversions view in ClickHouse
- [ ] Test view on worst wallets
- [ ] Create uiActivityEngineV6.ts
- [ ] Add NegRisk loader function
- [ ] Integrate synthetic buys into event stream
- [ ] Create validation script
- [ ] Run validation on 50 wallets
- [ ] Generate V6 accuracy report
- [ ] Compare against V3 baseline
- [ ] Document results

---

## Timeline

| Day | Task | Deliverable |
|-----|------|-------------|
| 1 | Create view + engine skeleton | vw_negrisk_conversions + V6 stub |
| 2 | Complete engine + validation script | Working V6 + validation |
| 3 | Run validation + iterate | V6 accuracy report |

---

## Appendix: Key SQL Patterns

### Token ID Hex to Decimal

```sql
-- For pm_erc1155_transfers token_id (hex string)
toString(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))))

-- For value (hex string to tokens)
reinterpretAsUInt64(reverse(unhex(substring(value, 3)))) / 1e6
```

### CLOB Deduplication Pattern

```sql
SELECT
  event_id,
  any(side) as side,
  any(usdc_amount) / 1e6 as usdc,
  any(token_amount) / 1e6 as tokens,
  any(trade_time) as trade_time
FROM pm_trader_events_v2
WHERE trader_wallet = '0x...' AND is_deleted = 0
GROUP BY event_id
```

---

*Plan created by Claude Code - 2025-11-29*
*Signed: Claude 1*
