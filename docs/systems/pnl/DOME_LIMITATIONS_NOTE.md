# Dome API Limitations Note

> **Status:** CANONICAL | **Created:** 2025-12-09

## Summary

Dome API's `realizedPnL` field is **NOT** a canonical benchmark for PnL validation. It measures **cash movement**, not profit.

---

## What Dome Measures

Dome's `realizedPnL` returns the sum of:
1. **CLOB cash flows** - USDC spent on buys (negative) and received from sells (positive)
2. **PayoutRedemption cash flows** - USDC received from claiming winning positions

That's it. No more.

---

## What Dome Excludes

| Excluded Item | Why It Matters |
|--------------|----------------|
| **Unredeemed winning tokens** | A wallet that won $100K but hasn't clicked "Redeem" shows $0 in Dome |
| **Mark-to-market value** | Open positions are ignored regardless of current price |
| **CTF merge/split flows** | Complex position management strategies are not captured |

---

## Why Dome Is Misleading for PnL

### Example: The Lazy Winner

Consider a wallet that:
- Spent $1,000 on YES tokens for an election market
- The market resolved YES (they won)
- They haven't redeemed their tokens yet

| Metric | Value | Explanation |
|--------|-------|-------------|
| **Dome `realizedPnL`** | -$1,000 | Only sees the cash out, not the unredeemed value |
| **Polymarket UI** | +$9,000 | Shows full realized value including pending redemption |
| **Our Synthetic Realized** | +$9,000 | Correctly accounts for resolved position value |

The user is a winner, but Dome says they're down $1,000.

---

## When Dome Is Useful

| Use Case | Suitable? | Why |
|----------|-----------|-----|
| Debugging cash flow pipeline | Yes | Direct comparison to on-chain events |
| Spot-checking CLOB trade ingestion | Yes | Verifies we captured all trades |
| **Release gate for V1 Leaderboard** | **NO** | Semantic mismatch on redemption handling |
| **Benchmarking PnL accuracy** | **NO** | Excludes key components of realized PnL |

---

## Recommended Approach

1. **Use Dome for debugging only** - Compare when investigating data pipeline issues
2. **Never use Dome as a release gate** - Low parity is expected and acceptable
3. **Use Playwright UI scraping for Total PnL validation** - Matches what users see
4. **Use Tier A Comparable + Synthetic Realized for V1 Leaderboard** - Our canonical metric

---

## Historical Context

### Why We Explored Dome

Early in PnL development, we assumed Dome would be a reliable blockchain-verifiable ground truth. After extensive testing (20+ wallets, multiple formula iterations), we discovered:

- **40% coverage** - Dome returns zeros for many wallets
- **Low parity at 10% tolerance** - Even wallets with coverage often mismatch
- **Root cause** - Semantic difference, not data quality issue

### Decision Recorded

As of 2025-12-09, Dome validation has been downgraded from "required release gate" to "optional diagnostic tool."

---

## Related Documents

- [PNL_VOCABULARY_V1.md](./PNL_VOCABULARY_V1.md) - Four PnL definitions
- [DOME_REALIZED_VALIDATION_SPEC_V1.md](./DOME_REALIZED_VALIDATION_SPEC_V1.md) - Full validation spec
- [VALIDATION_MATRIX_V1.md](./VALIDATION_MATRIX_V1.md) - Which benchmark for which metric
- [TIER_A_COMPARABLE_SPEC.md](./TIER_A_COMPARABLE_SPEC.md) - V1 Leaderboard wallet criteria
