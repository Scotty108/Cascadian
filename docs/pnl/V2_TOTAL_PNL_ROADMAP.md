# V2 Total PnL Roadmap: UI Parity with Realized + Unrealized

**Created:** 2025-12-07
**Status:** Planning Required

---

## Context

V1 leaderboard ships with **realized-only PnL** validated against Dome.

V2 will add **total PnL (realized + unrealized)** to match Polymarket UI.

---

## Key Insight

For validation purposes:
- **Realized validation:** Compare `our_realized` vs `dome_realized` for any wallet, regardless of open positions
- **Total validation:** Compare `our_realized + our_unrealized` vs `ui_total_pnl`

The "all positions closed" filter is a **display choice** for V1, not an accuracy requirement.

---

## V1 Status (Realized-Only)

| Metric | Value |
|--------|-------|
| Engine | V11 |
| Benchmark | Dome Realized |
| Pass Rate | 71% on transfer_free |
| Cohort | CLOB-only, min $200, min 10 trades |

---

## V2 Requirements (Total PnL)

### 1. Unrealized Position Valuation

Need reliable pricing for open positions:
- Current market price per outcome
- Position size (shares held)
- Formula: `unrealized = shares * current_price - cost_basis`

### 2. Data Sources for Current Prices

Options:
- Polymarket CLOB mid-price
- Last trade price
- Gamma API prices

### 3. Validation Target

- **Benchmark:** Polymarket UI total PnL
- **Threshold:** Same as V1 (±6% for large, ±$10 for small)

### 4. Cohort Expansion

V2 can include wallets with active positions since we'll be valuing them.

---

## Open Questions for Planning

1. What's the best source for current outcome prices?
2. How do we handle stale prices for illiquid markets?
3. Should V2 be a separate leaderboard or replace V1?
4. How often should unrealized be recalculated?

---

## Files to Reference

- `lib/pnl/engines/realizedUiStyleV2.ts` - Current realized engine
- `lib/pnl/pnlComposerV1.ts` - PnL orchestrator (needs unrealized path)
- `scripts/pnl/validate-ui-parity.ts` - Validation harness

---

*This document captures the V2 planning scope. Use planning agent to create detailed implementation plan.*
