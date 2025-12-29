# Realized PnL Metric Taxonomy

**Version:** 1.0
**Date:** 2025-12-09
**Status:** Production

## Overview

Cascadian maintains **three distinct realized PnL metrics**, each serving a specific purpose. Understanding when to use each metric is critical for accurate reporting and external validation.

## Metric Definitions

### 1. V12 Synthetic (Product Metric)

**Use For:** Cascadian product displays, leaderboards, wallet comparisons

**Formula:**
```
Realized = CLOB(dedup) usdc_delta + (token_delta * payout_norm) for resolved markets
```

**Definition:**
- Credits resolution value even WITHOUT redemption
- If you hold winning shares and the market resolves, the synthetic value is realized
- This is "mark-to-resolution" valuation

**Source Types:**
- CLOB trades (deduped by event_id)
- Resolution values (synthetic)

**Implementation:** `lib/pnl/realizedPnlV12.ts` → `calculateRealizedPnlV12()`

**When to Use:**
- Product metrics (leaderboard, wallet page)
- Polymarket UI comparisons
- When you need "total value realized at resolution"

---

### 2. V12 CashFull (Internal Analytics)

**Use For:** Internal analytics, complete cash flow accounting

**Formula:**
```
CashFull = CLOB(dedup) + PayoutRedemption + PositionsMerge + PositionSplit
```

**Definition:**
- All actual USDC cash flows from the unified ledger
- Includes CTF complete-set redemptions (PositionsMerge)
- Includes CTF minting costs (PositionSplit)
- No synthetic valuation

**Source Types:**
- CLOB: Trade cash flows (deduped by event_id)
- PayoutRedemption: Market resolution payouts
- PositionsMerge: CTF complete-set redemptions (+USDC)
- PositionSplit: CTF minting (-USDC)

**Implementation:** `lib/pnl/realizedPnlV12Cash.ts` → `calculateRealizedPnlV12CashFull()`

**When to Use:**
- Internal cash flow analytics
- Complete transaction accounting
- When you need "all USDC movements"

---

### 3. V12 DomeCash (Validation Metric)

**Use For:** Dome API validation ONLY

**Formula:**
```
DomeCash = CLOB(dedup) + PayoutRedemption
```

**Definition:**
- Strict Dome API parity validator
- EXCLUDES PositionsMerge and PositionSplit
- Only counts CLOB trades and market redemptions
- Matches Dome's definition of "realized"

**Source Types:**
- CLOB: Trade cash flows (deduped by event_id)
- PayoutRedemption: Market resolution payouts
- NO PositionsMerge
- NO PositionSplit

**Implementation:** `lib/pnl/realizedPnlV12Cash.ts` → `calculateRealizedPnlV12DomeCash()`

**When to Use:**
- Validating our calculations against Dome API
- Debugging Dome discrepancies
- **Never use for product metrics**

---

## Comparison Matrix

| Aspect | V12 Synthetic | V12 CashFull | V12 DomeCash |
|--------|---------------|--------------|--------------|
| CLOB (deduped) | ✓ | ✓ | ✓ |
| PayoutRedemption | ✓ | ✓ | ✓ |
| PositionsMerge | ✗ | ✓ | ✗ |
| PositionSplit | ✗ | ✓ | ✗ |
| Unredeemed shares × resolution | ✓ | ✗ | ✗ |
| **Use Case** | Product | Analytics | Validation |

## Decision Tree

```
Need realized PnL metric?
│
├─ For product display / leaderboard?
│  └─ Use V12 Synthetic ✓
│
├─ For internal analytics / cash accounting?
│  └─ Use V12 CashFull (NOT for Dome comparison)
│
├─ For validating against Dome API?
│  ├─ CTF-active wallet (Merge > 0)?
│  │  └─ Use V12 Synthetic ✓ (cash metrics fail badly)
│  └─ CLOB-only wallet (Merge = 0)?
│     └─ Use V12 Synthetic or DomeCash
│
└─ For comparing to Polymarket UI?
   └─ Use V12 Synthetic ✓ (BEST match for ALL wallet types)
```

**UPDATE 2025-12-09:** V12 Synthetic is the canonical Dome-parity metric.
DomeCash is only valid for CLOB-only wallets and should be deprecated.

## Key Insights

### Why DomeCash ≠ CashFull

Dome API does NOT count CTF operations (PositionsMerge/PositionSplit) as realized PnL:
- **PositionsMerge:** When you redeem a complete set of YES+NO tokens for USDC
- **PositionSplit:** When you mint YES+NO tokens by depositing USDC

Dome considers these as "internal position management" rather than trading gains.

### Why Synthetic ≠ DomeCash

V12 Synthetic credits value for unredeemed winning shares. Example:
- You buy YES tokens for $0.50
- Market resolves YES (shares worth $1.00)
- **Synthetic:** Immediately credits $0.50 gain per share
- **DomeCash:** Credits $0 until you actually redeem

### CLOB Deduplication (Critical)

The V8 ledger has duplicate CLOB rows (1.5-2.1x inflation). ALL metrics MUST dedupe:
```sql
SELECT event_id, any(usdc_delta) as usdc_delta
FROM pm_unified_ledger_v8_tbl
WHERE source_type = 'CLOB'
GROUP BY event_id
```

## Benchmark Results

### CLOB-Only Cohort (50 wallets with Merge=0)

| Metric | Dome Pass Rate | Notes |
|--------|---------------|-------|
| V12 Synthetic | ~8% | Unredeemed shares cause gap |
| V12 CashFull | ~12% | Identical to DomeCash (Merge=0) |
| V12 DomeCash | ~12% | Best Dome parity for CLOB-only |

### CTF-Active Cohort (30 wallets with Merge>0)

**CRITICAL FINDING (2025-12-09):** For CTF-active wallets, V12 Synthetic is the ONLY metric that tracks Dome.

| Wallet | Dome | Synthetic | SynthErr | CashFull | FullErr | DomeCash | DomeErr |
|--------|------|-----------|----------|----------|---------|----------|---------|
| 0x5df52b | $847 | $826 | **2.6%** | $825 | 2.6% | -$172K | 20434% |
| 0xb15e92 | $179 | $199 | **10.9%** | $38.7K | 21502% | -$108K | 60453% |
| 0x91585a | $159 | $169 | **6.5%** | $24K | 15017% | -$79K | 50049% |

**Conclusion:** Dome API uses synthetic valuation, not cash flow accounting.
Cash-based metrics (CashFull, DomeCash) fail badly for CTF-active wallets.

## Files

| File | Purpose |
|------|---------|
| `lib/pnl/realizedPnlV12.ts` | V12 Synthetic calculator |
| `lib/pnl/realizedPnlV12Cash.ts` | V12 CashFull + V12 DomeCash calculators |
| `scripts/pnl/benchmark-v12-realized-dual.ts` | Triple benchmark harness |

## Validation Process

1. **Product metrics:** Use `calculateRealizedPnlV12()`
2. **Dome validation:** Compare `calculateRealizedPnlV12DomeCash()` vs Dome API
3. **If DomeCash matches Dome:** Our CLOB + redemption data is correct
4. **If DomeCash doesn't match Dome:** Investigate time windows or filtering

## UI Tooltip Validation

### Why Tooltip Truth?

The Polymarket UI tooltip provides an **identity check** that proves we're scraping the correct value:

```
Tooltip shows: Gain, Loss, Net Total
Identity: Gain - |Loss| = Net Total
```

If the identity holds, we have high confidence in the scraped `Net Total` value.

### Tooltip Truth Pipeline

**Scripts:**
1. `scripts/pnl/scrape-tooltip-truth-v2.ts` - Playwright scraper
2. `scripts/pnl/validate-v12-vs-tooltip-truth.ts` - V12 validator

**Ground Truth Files:**
- `tmp/playwright_tooltip_ground_truth.json` - Scraped UI values
- `tmp/v12_vs_tooltip_truth.json` - Validation results

**Schema (v2.0):**
```typescript
interface TooltipTruthOutput {
  metadata: {
    generated_at: string;
    source: 'playwright_tooltip_verified';
    schema_version: '2.0';
    wallet_count: number;
  };
  wallets: Array<{
    wallet: string;
    uiPnl: number;       // Net Total from tooltip
    gain: number | null;  // Gain component
    loss: number | null;  // Loss component (negative)
    volume: number | null;
    scrapedAt: string;
    identityCheckPass: boolean;  // Gain - |Loss| = Net Total
    label: string;        // clob-only, ctf-active, leaderboard
    notes: string;
  }>;
}
```

### Validation Workflow

1. **Scrape**: Run `scrape-tooltip-truth-v2.ts` to collect tooltip values
2. **Validate**: Run `validate-v12-vs-tooltip-truth.ts` against ground truth
3. **Review**: Check pass rates by wallet label (clob-only vs ctf-active)

### Expected Pass Rates

| Cohort | Expected V12 Synthetic Pass Rate | Notes |
|--------|----------------------------------|-------|
| CLOB-only | 70-90% | Straightforward wallets |
| CTF-active | 50-70% | May need more investigation |
| Whales (>$1M) | Variable | Complex trading patterns |

### When to Re-Scrape

- After significant engine changes
- After backfill updates
- When building new validation cohorts

## Changelog

- **2025-12-09 (v1.2):** Added UI Tooltip Validation section
  - Tooltip truth is now the canonical UI parity reference
  - Schema version 2.0 with `identityCheckPass` field
  - `validate-v12-vs-tooltip-truth.ts` created
- **2025-12-09 (v1.1):** CTF-active benchmark proves V12 Synthetic is canonical
  - V12 Synthetic achieves 2.6-40% error vs Dome on CTF-active wallets
  - Cash metrics (CashFull, DomeCash) fail with 15,000-60,000% error
  - DomeCash deprecated for Dome validation
- **2025-12-09 (v1.0):** Initial taxonomy with three metrics
