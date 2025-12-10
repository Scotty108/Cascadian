# PnL Root Cause Investigation Report

**Date:** 2025-11-29
**Investigator:** Claude Code
**Status:** Critical Findings Identified

---

## Executive Summary

Investigation into the two worst sign-mismatch wallets (0x4ce73141... and 0x8e9eedf2...) revealed multiple critical issues:

1. **Data has 3x duplicates** in pm_trader_events_v2 (engines correctly dedupe via GROUP BY event_id)
2. **Token gap unexplained** - wallets sell vastly more tokens than they buy or receive
3. **V3 engine returns WRONG SIGN** (-$282K vs UI +$332K)
4. **Missing cost basis for NegRisk conversions** is likely the root cause

---

## Key Findings

### Finding 1: Data Duplication (3x factor)

```
Wallet: 0x4ce73141dbfce41e65db3723e31059a730f0abad

RAW vs DEDUPED:
Side: buy
  Raw rows: 188,082
  Unique event_ids: 62,724
  Duplication factor: 3.00x

Side: sell
  Raw rows: 1,677,724
  Unique event_ids: 560,154
  Duplication factor: 3.00x
```

**Impact:** V3/V4/V5 engines all use `GROUP BY event_id` pattern and correctly deduplicate. This is NOT the root cause of sign errors.

### Finding 2: Token Reconciliation Failure

After proper deduplication:

| Metric | Wallet 1 | Wallet 2 |
|--------|----------|----------|
| CLOB Bought | 35.8M tokens | 2.6M tokens |
| CLOB Sold | 379M tokens | 38.8M tokens |
| Token Gap | 343M tokens | 36.2M tokens |
| ERC1155 Net | -43.6M (out > in) | -3.8M (out > in) |
| **Unexplained Gap** | **387M tokens** | **40M tokens** |

The wallets are selling **vastly more tokens** than they acquire through all tracked sources.

### Finding 3: V3 Sign Mismatch

| Wallet | UI PnL | V3 PnL | Sign Match |
|--------|--------|--------|------------|
| 0x4ce73141... | +$332,563 | -$282,753 | ❌ NO |
| 0x8e9eedf2... | +$360,492 | -$73,XXX | ❌ NO |

Both wallets show **positive PnL on UI** but **negative PnL from V3**.

### Finding 4: Source Analysis

| Source | Transfers | Tokens |
|--------|-----------|--------|
| NegRisk Adapter IN | 13,130 | 10.2M |
| NegRisk CTF IN | 12,453 | 5.8M |
| Exchange IN | 23 | 3.3K |
| **Total ERC1155 IN** | **25,606** | **16M** |

| Destination | Transfers | Tokens |
|-------------|-----------|--------|
| NegRisk CTF OUT | 84,122 | 52.4M |
| Unknown (0xa5ef...) OUT | 8,365 | 6.7M |
| NegRisk Adapter OUT | 277 | 0.6M |
| **Total ERC1155 OUT** | **92,782** | **59.6M** |

**Net ERC1155:** -43.6M tokens (wallet sends OUT more than receives)

---

## Root Cause Analysis

### Per the "First Principles" Research Document:

> "A standard wallet tracker that only looks at Transfer events will fail to calculate PnL correctly because it misses the cost basis established during a Split or the realized revenue from a Merge."

The key insight is **NegRisk conversions**:

1. User converts positions via NegRisk Adapter
2. This creates ERC1155 transfers (which we see)
3. But the **cost basis** for these conversions isn't tracked
4. When user sells tokens acquired via NegRisk, we see SELL without prior BUY
5. Engine interprets this as "selling tokens that cost $X" but X is wrong

### The "Total In vs Total Out" Method

Per the research document, correct PnL calculation is:

```
PnL = (Total_Returned + Current_Value) - Total_Invested

Where:
- Total_Invested = CLOB Buys + USDC locked in Splits
- Total_Returned = CLOB Sells + USDC from Merges + Redemptions
- Current_Value = Holdings × Current_Market_Price
```

### Why V3 Shows Wrong Sign

V3 likely:
1. Tracks CLOB trades correctly ✓
2. Handles redemptions correctly ✓
3. **Does NOT track NegRisk conversions** ❌
4. **Does NOT track Split cost basis properly** ❌

When a user receives tokens via NegRisk and sells them:
- V3 sees: SELL with no matching BUY
- V3 calculates: Realized loss (sold tokens with unknown/high cost basis)
- Reality: Tokens came from NegRisk at $0.50 equivalent

---

## Tables Analysis

### Tables We Track

| Table | Rows | What It Contains |
|-------|------|------------------|
| pm_trader_events_v2 | 781M | CLOB trades (3x duplicated) |
| pm_ctf_events | 116M | CTF events (Redemptions) |
| pm_erc1155_transfers | 42.6M | Token transfers |
| pm_ctf_split_merge_expanded | 31.7M | Split/Merge events |
| pm_fpmm_trades | 4.4M | AMM trades |
| pm_ctf_flows_inferred | 10.4M | Inferred flows |

### What's Missing

1. **NegRisk conversion cost basis** - we see transfers but not the USDC flow
2. **Complete Split tracking** - pm_ctf_split_merge_expanded has 0 splits for these wallets
3. **Cross-reference with USDC flows** - to verify net USDC in/out

---

## Data Gaps Confirmed

### Wallet 1 (0x4ce73141...)

| Source | Events | Expected | Found |
|--------|--------|----------|-------|
| CLOB Trades | Many | Yes | ✓ |
| Redemptions | 22 | Yes | ✓ |
| Splits | 0 | Unknown | ✗ |
| Merges | 0 | Unknown | ✗ |
| FPMM | 0 | Unknown | ✗ |
| NegRisk Transfers | 25K+ | Partial | ⚠️ |

**Key Gap:** 387M tokens sold with no tracked source.

---

## Recommended V6 Implementation

### Phase 1: NegRisk Conversion View

Create `vw_negrisk_conversions` that:
1. Filters pm_erc1155_transfers for NegRisk contracts
2. Converts hex token_id and value fields
3. Groups transfers into logical "conversion events"
4. Assigns $0.50 cost basis (Polymarket split price)

### Phase 2: Engine Integration

Modify V3 to:
1. Load NegRisk conversions as synthetic BUY events
2. Use $0.50 cost basis for tokens received from NegRisk
3. Keep existing CLOB deduplication
4. Keep existing resolution handling

### Phase 3: Validation

1. Re-run 50-wallet benchmark
2. Focus on the worst sign-mismatch wallets
3. Measure improvement in:
   - Sign accuracy (target: 85%+)
   - Median error (target: <15%)

---

## Contract Addresses Reference

| Contract | Address | Purpose |
|----------|---------|---------|
| CTF | 0x4D97DCd97eC945f40cF65F87097ACe5EA0476045 | Conditional Token Framework |
| CTF Exchange | 0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E | CLOB trading |
| NegRisk Adapter | 0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296 | NegRisk conversions |
| NegRisk CTF | 0xC5d563A36AE78145C45a50134d48A1215220f80a | NegRisk positions |

---

## Next Steps

1. **Build vw_negrisk_conversions view** - track token acquisitions from NegRisk
2. **Create V6 engine** - integrate NegRisk cost basis
3. **Run validation** - compare against UI values
4. **Iterate** - adjust cost basis if needed ($0.50 may not be exact)

---

*Report generated by Claude Code - 2025-11-29*
*Signed: Claude 1*
