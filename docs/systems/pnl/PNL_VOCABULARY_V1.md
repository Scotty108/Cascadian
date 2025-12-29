# PnL Vocabulary V1

> **Status:** CANONICAL | **Last Updated:** 2025-12-09

This document defines the authoritative vocabulary for all PnL-related work in Cascadian. Everyone must use these exact definitions.

---

## The Four PnL Definitions

### 1. Dome Cashflow View (Non-Authoritative)

> **Note:** This is NOT a canonical PnL metric. It measures cash movement, not profit.

**Definition:** Cash that has actually moved through on-chain redemptions only.

**Formula:**
```
dome_cashflow = CLOB cash_flow + PayoutRedemption cash_flow
```

**What it includes:**
- USDC spent on buys (negative)
- USDC received from sells (positive)
- USDC received from claiming winning positions (PayoutRedemption events)

**What it excludes:**
- Unredeemed winning tokens (even if the market resolved)
- Open positions (unresolved markets)
- CTF merge/split cash flows (different accounting treatment)

**External Source:** Dome API `realizedProfit` field

**When to use:** Debugging cash flows, spot-checking data pipeline

**When NOT to use:** Release gates, benchmarking, leaderboard validation

**NEVER validate against:** Polymarket UI tooltip (which shows Total PnL)

See: [DOME_LIMITATIONS_NOTE.md](./DOME_LIMITATIONS_NOTE.md)

---

### 2. Synthetic Realized PnL (Copy-Trading Truth)

**Definition:** Realized profit/loss treating resolved positions as cashed out, even if tokens weren't redeemed.

**Formula:**
```
synthetic_realized_pnl = usdc_delta + (token_delta × payout_norm)
```

Where:
- `usdc_delta`: Cash flow from trades (negative for buys, positive for sells)
- `token_delta`: Net token position change (positive for buys, negative for sells)
- `payout_norm`: Resolution payout (0 or 1 for binary markets, extracted from `payout_numerators`)

**What it includes:**
- All CLOB cash flows
- The locked-in value of resolved positions (regardless of redemption)

**What it excludes:**
- Open positions in unresolved markets
- Mark-to-market valuation

**Benchmark:** Internal consistency + UI parity on low-unresolved wallets

**When to use:** Copy-trading leaderboards, wallet performance ranking

**NEVER validate against:** Dome API (which requires actual redemption)

---

### 3. Unrealized PnL

**Definition:** Mark-to-market value of open positions minus cost basis.

**Formula:**
```
unrealized_pnl = SUM(position_size × (current_price - avg_entry_price))
```

**What it includes:**
- Positions in unresolved markets
- Current mid-market pricing

**What it excludes:**
- Resolved positions
- Cash flows

**Benchmark:** Live market prices (best bid/ask mid or recent trade)

**When to use:** Real-time portfolio view, "how am I doing right now"

**Implementation status:** Not yet built (requires real-time pricing feed)

---

### 4. Total PnL

**Definition:** Complete profit/loss picture including both realized and unrealized.

**Formula:**
```
total_pnl = synthetic_realized_pnl + unrealized_pnl
```

**Benchmark:** Polymarket UI tooltip (Net Total from "All Time")

**When to use:** User-facing total performance display

**Implementation status:** Requires unrealized engine (pending)

---

## Validation Rules Matrix

| Definition | Validate Against | NEVER Validate Against |
|------------|-----------------|------------------------|
| Dome-Realized | Dome API | UI tooltip |
| Synthetic Realized | UI (low-unresolved only) | Dome API |
| Unrealized | Live market prices | Dome, historical snapshots |
| Total | UI tooltip (All Time) | Dome API |

---

## Key Insight: Why UI Validation Fails for Realized

Polymarket UI tooltip shows **Total PnL** (realized + unrealized).

When a wallet has open positions:
- UI includes unrealized gains/losses
- Our Synthetic Realized only counts resolved

**Result:** Wallets with high unresolved % will fail UI validation even with a correct formula.

**Solution:** Only validate Synthetic Realized against UI for "Comparable" wallets (≤5% unresolved).

---

## Terminology Quick Reference

| Term | Meaning |
|------|---------|
| `usdc_delta` | USDC cash flow per event (negative = spent, positive = received) |
| `token_delta` | Token position change (positive = acquired, negative = sold) |
| `payout_norm` | Normalized resolution price (0 or 1 for binary) |
| `unresolved_pct` | % of events in unresolved markets |
| `Tier A Comparable` | Wallets with ≤5% unresolved, ≥$1K PnL, ≥10 events |
| `Dome` | External API providing blockchain-verifiable PnL |
| `CLOB` | Central Limit Order Book (Polymarket's order matching) |
| `CTF` | Conditional Token Framework (ERC1155 tokens) |

---

## Engine Mapping

| Engine | Implements | Status |
|--------|-----------|--------|
| V12 Synthetic | Synthetic Realized | **CANONICAL** |
| V12 CashFull | Full cash accounting (CLOB + Payout + Merge/Split) | Supporting |
| V12 DomeCash | Dome-style (CLOB + Payout only) | Supporting |
| Mark-to-Market | Unrealized | Not implemented |
| Total | Total PnL | Not implemented |

---

## Related Documents

- [PERSISTED_OBJECTS_MANIFEST.md](./PERSISTED_OBJECTS_MANIFEST.md) - Canonical tables
- [TIER_A_COMPARABLE_SPEC.md](./TIER_A_COMPARABLE_SPEC.md) - Wallet classification
- [V12_ARCHITECTURE_SPEC.md](./V12_ARCHITECTURE_SPEC.md) - Engine implementation
