# V12 PnL Engine Architecture Specification

**Date:** 2025-12-07
**Status:** Approved for implementation
**Scope:** CLOB-first with explicit metric separation

---

## Core Design Principle

Track resolution value as **two parallel notions**:
1. **Realized via explicit events** - What the user actually redeemed or sold
2. **Synthetic/implicit resolution** - Mark-to-payout for resolved markets without redemption events

The UI blends these in ways that aren't purely cashflow or event-based, so we need both lenses.

---

## Metric Set

### A) Trading Realized PnL (CLOB)
```
realized_pnl_clob
```
Cost basis realized only on sells via CLOB orderbook.

### B) Redemption Realized PnL (CTF) - V2 scope
```
realized_pnl_redemption
```
PnL recognized only when PayoutRedemption events occur.

### C) Synthetic Resolution PnL
```
synthetic_resolution_pnl
```
PnL from unresolved ledger state where market is resolved but no redemption event exists.
**This is what can overcount relative to UI.**

### D) Mark-to-Market Unrealized PnL
```
unrealized_pnl_live
```
Open positions valued at current prices.

### E) Total Variants

**1) UI-match total (event-first)**
```
total_pnl_ui_mode = realized_pnl_clob + realized_pnl_redemption + unrealized_pnl_live
```
Safest default for UI matching.

**2) Economic total (includes synthetic)**
```
total_pnl_economic = realized_pnl_clob + realized_pnl_redemption + unrealized_pnl_live + synthetic_resolution_pnl
```

---

## Position Value Breakdown

Replace single "positions value" with:
- `open_position_value_live` - Unresolved, priced at live market
- `resolved_unredeemed_value` - Winning value not yet redeemed
- `redeemed_value` - Informational, from PayoutRedemption events

---

## Wallet Classification System

### Badge Types
| Badge | Criteria |
|-------|----------|
| `CLOB_ONLY` | 0 CTF events, all activity via orderbook |
| `REDEMPTION_HEAVY` | >10 PayoutRedemption events |
| `SPLIT_MERGE` | >0 PositionSplit or PositionsMerge events |
| `TRANSFER_HEAVY` | >5 ERC1155 transfers |
| `MIXED` | Combination of above |

### Copy-Eligibility Score
High score requires:
- CLOB_ONLY or CLOB-dominant behavior
- UI presence confirmed
- Minimal unexplained position deltas
- Behavior aligns with what we can mirror

---

## Engine Configuration

```typescript
type PnlMode = "ui_mode" | "economic_mode";

type PnlConfig = {
  mode: PnlMode;
  includeSyntheticResolution?: boolean;
  includeRedemptions?: boolean;      // V2
  includeSplitsMerges?: boolean;     // V3
};

type ContributionType =
  | "clob_sell"
  | "ctf_redemption"
  | "synthetic_resolution"
  | "unrealized_live";
```

---

## Synthetic Resolution Safety Rules

Only compute `synthetic_resolution_pnl` for positions that satisfy ALL:
1. Market has reliable resolution record
2. Wallet has positive remaining qty for resolved outcome
3. **No matching redemption observed for that qty**

The third rule prevents double-counting in wallets with heavy redemptions.

Conservative gating: If ANY redemption exists for that condition+wallet, require stronger evidence before applying synthetic.

---

## Phased Rollout

### V1 (Now): CLOB-Only Leaderboard
- Filter to CLOB_ONLY wallets with UI presence
- Use `realized_pnl_clob` as primary metric
- Synthetic resolution as separate, optional metric
- Copy engine mirrors CLOB trades only

### V2: Redemption-Aware CTF
- Add PayoutRedemption processing
- Include `realized_pnl_redemption` in totals
- Unlock REDEMPTION_HEAVY wallets for leaderboard

### V3: Split/Merge Correctness
- Add PositionSplit/Merge cost basis updates
- Full CTF support
- Unlock MIXED wallets

---

## Validation Tests

### Test 1: Control wallet with no CTF
- Expect: `synthetic_resolution_pnl` can exist
- Expect: `total_pnl_ui_mode` closer to UI than naive auto-resolution

### Test 2: Heavy redemption wallet
- Expect: `realized_pnl_redemption` is large
- Expect: `synthetic_resolution_pnl` small/zero after gating

### Test 3: Whale fully closed
- Expect: `unrealized_pnl_live` = 0
- Expect: `synthetic_resolution_pnl` = 0
- Remaining discrepancy = mapping/fills/proxy issues

---

## UI Presentation

### Leaderboard Views
- **Default**: CLOB_ONLY wallets, UI PnL mode
- **Toggle**: "Include mixed wallets"

### PnL Display
- **Default**: UI-mode PnL (event-first)
- **Toggle**: "Show economic PnL" (includes synthetic resolution)

### Wallet Cards
- Show classification badge
- Show copy-eligibility score
- Flag if synthetic resolution contributes significantly

---

## Implementation Status

**This spec is implemented in V29 (inventoryEngineV29.ts).**

### V29 Metric Mapping

| Spec Metric | V29 Implementation |
|-------------|-------------------|
| `realized_pnl_clob` | `realizedPnl` (includes redemptions) |
| `synthetic_resolution_pnl` | `resolvedUnredeemedValue` |
| `unrealized_pnl_live` | `unrealizedPnl` |
| `total_pnl_ui_mode` | `uiParityPnl` |
| `total_pnl_economic` | `totalPnl` |

### Files Implemented

1. ✅ `lib/pnl/inventoryEngineV29.ts` - Engine with separated metrics
2. ✅ `lib/pnl/walletClassifier.ts` - Badge classification logic (TRADER_STRICT, MAKER, etc.)
3. 🔄 Leaderboard API - Use V29 metrics
4. 🔄 UI - Show badges and PnL mode toggle

---

*Spec approved 2025-12-07*
*Implementation verified: V29 matches spec 2025-12-07*
