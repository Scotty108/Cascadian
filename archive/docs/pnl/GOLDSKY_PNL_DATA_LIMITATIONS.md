> **DEPRECATED PNL DOC**
> Archived. Reflects earlier attempts to match Goldsky PnL.
> Not the current spec for Cascadian.
> See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

# Goldsky PnL Data Limitations

**Status:** CRITICAL - Read before using any PnL data
**Created:** 2025-11-21
**Last Updated:** 2025-11-21

## Executive Summary

**The Goldsky-sourced PnL fields in our ClickHouse tables are NOT trustworthy for production use.**

This document explains why, what we attempted, and what is needed to fix it.

---

## Tables Affected

### 1. `pm_user_positions` - PnL Fields

| Field | Status | Issue |
|-------|--------|-------|
| `realized_pnl` | **UNRELIABLE** | Contains zeros, missing losses, absurd magnitudes ($2T+) |
| `unrealized_pnl` | **UNRELIABLE** | Same issues as realized_pnl |
| `total_bought` | **PARTIALLY BROKEN** | Some values impossibly high |
| `total_sold` | **BROKEN** | Many zeros where there should be non-zero values |

**Evidence:**
- `total_sold` frequently shows 0 even for closed positions
- `realized_pnl` shows $2+ trillion for some wallets (impossible)
- Missing losses: wallets with known losing positions show 0 or positive PnL
- Inflated gains: some wallets show unrealistic profit figures

### 2. `pm_trader_events` - Structural Limitation

| Issue | Description |
|-------|-------------|
| **No direction field** | `amount_usdc` is always positive - no buy/sell indicator |
| **Multi-party events** | One transaction creates events for BOTH buyer and seller |
| **No price per fill** | Cannot determine execution price from the data |
| **No fees** | Trading fees not captured separately |

**What the data CAN tell you:**
- `token_id = '0'` → USDC cash flow leg
- `token_id != '0'` → Outcome token transfer leg
- Volume per wallet (sum of all `amount_usdc`)
- Trading frequency

**What the data CANNOT tell you:**
- Whether a specific event is a BUY or SELL
- Per-fill PnL
- Entry/exit prices
- Fees paid

---

## What We Tried

### Attempt 1: Use `pm_user_positions.realized_pnl` directly
**Result:** Failed - data shows impossible values ($2T+ PnL)

### Attempt 2: Cross-validate against `pm_trader_events` USDC flow
**Result:** Misleading - achieved 4.11% variance but this was **internal-to-internal consistency**, not external validation. Two broken data sources agreed with each other.

### Attempt 3: External validation via polymarketanalytics.com
**Result:** Failed - site returned 404

### Attempt 4: External validation via Polymarket API
**Result:** Failed - API only returns current open positions, not historical PnL

---

## Current State

### Provisional Views (Renamed with `_PROVISIONAL` suffix)

These views exist but should NOT be used for production:

| View | Purpose | Why Provisional |
|------|---------|-----------------|
| `pm_wallet_metrics_PROVISIONAL` | Wallet-level stats (PnL, win rate, Omega) | Built on unreliable `realized_pnl` |
| `pm_wallet_pnl_PROVISIONAL` | Basic wallet PnL | Built on unreliable `realized_pnl` |
| `pm_wallet_pnl_by_category_PROVISIONAL` | PnL by market category | Built on unreliable `realized_pnl` |
| `pm_wallet_pnl_by_tag_PROVISIONAL` | PnL by market tag | Built on unreliable `realized_pnl` |

### What IS Reliable

| Table/View | Status | Use Case |
|------------|--------|----------|
| `pm_token_to_condition_map` | **RELIABLE** | Bridge between token_id_dec and condition_id (64-char hex) |
| `pm_market_metadata` | **RELIABLE** | Market questions, categories, tags, slugs |
| `pm_trader_events` (volume only) | **RELIABLE** | Trading volume, frequency, wallet activity |

---

## Requirements for Accurate PnL

To compute accurate wallet PnL, we need **fills-level data** with:

```
Required fields per fill:
├── wallet_address      # Who executed the fill
├── condition_id        # Which market (64-char hex)
├── outcome_index       # 0 or 1 (which outcome token)
├── side                # BUY or SELL ← CRITICAL MISSING FIELD
├── price               # Execution price (0.00-1.00)
├── size                # Number of shares
├── fees                # Trading fees paid
└── timestamp           # When the fill occurred
```

### PnL Calculation Formula (once we have proper fills)

```
Per-Fill PnL:
  BUY:  -1 * (price * size + fees)  # Cost to enter
  SELL: +1 * (price * size - fees)  # Proceeds from exit

Realized PnL = Sum of all fills for closed positions
Unrealized PnL = Current market price * remaining shares - cost basis
```

---

## Next Steps

1. **Request fills-level data from Goldsky**
   - Ask specifically for `side` (direction) field
   - Ask for `price` per fill
   - Ask for `fees` breakdown

2. **Alternative: Decode from blockchain**
   - Parse CLOB contract events directly
   - Would need to understand Polymarket's contract ABI

3. **Alternative: Use Polymarket's official analytics**
   - If they expose an API or data feed with accurate PnL
   - Currently no known public endpoint

---

## Lessons Learned

1. **Internal consistency ≠ External accuracy**
   - Two data sources agreeing doesn't mean either is correct
   - Always validate against known ground truth

2. **Direction matters**
   - You cannot compute PnL from volume alone
   - Need explicit buy/sell indicator per fill

3. **Don't ship on broken foundations**
   - Views built on unreliable data are unreliable
   - Mark them clearly (we used `_PROVISIONAL` suffix)

---

## References

- ChatGPT/Codex analysis (2025-11-21): Correctly identified these limitations
- Polymarket CLOB API docs: https://docs.polymarket.com/
- Goldsky data schema: (internal documentation)

---

*This document should be updated when fills-level data becomes available or an alternative solution is implemented.*
