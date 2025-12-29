# Copy-Trading Portfolio Validation Report

**Generated:** 2025-12-18T20:11:23.304Z
**Methodology:** V2 Shadow Simulation Pipeline

---

## Executive Summary

This report documents the systematic selection of 8 wallets for copy-trading $1000 on Polymarket.

| Metric | Value |
|--------|-------|
| Total Wallets | 8 |
| Total Allocated | $925 |
| Unique Strategies | 4 |
| Unique Categories | 5 |

---

## Methodology

### 8-Phase Pipeline

1. **Candidate Universe** - Unbiased pull from pm_unified_ledger_v6
2. **Core Metrics** - V19s P&L calculation with calibrated gates
3. **Copyability Scoring** - Entry price, hold time, concentration analysis
4. **Strategy Classification** - Value, Momentum, Event-Driven, Generalist
5. **Shadow Simulation** - 30s delay, 0.5% slippage, skip rules
6. **Portfolio Construction** - Capped tiers (60/30/10 split)
7. **Playwright Validation** - UI verification
8. **Final Export** - This report

### Selection Criteria

- **Omega > 1.5** (profitable)
- **Shadow Omega > 1.2** (still profitable after friction)
- **Execution Drag < 40%** (edge survives copy delay)
- **Avg Entry < 85%** (not safe-bet grinding)
- **Active in last 14 days**

---

## Tier Allocation

| Tier | Wallets | Allocation | Purpose |
|------|---------|------------|---------|
| Conservative | 5 | $750 (60%) | High omega, low drawdown |
| Balanced | 1 | $75 (30%) | Good returns, moderate risk |
| Aggressive | 2 | $100 (10%) | Higher risk/reward |

---

## Diversification

### By Strategy
| Strategy | Count |
|----------|-------|
| Event-Driven | 2 |
| Mixed | 2 |
| Generalist | 2 |
| Value | 2 |

### By Category
| Category | Count |
|----------|-------|
| Culture | 1 |
| Other | 2 |
| Sports | 1 |
| Unknown | 2 |
| Politics | 2 |

---

## Selected Wallets

### 1. 0x8247f6d658b0af...

| Attribute | Value |
|-----------|-------|
| **Tier** | conservative |
| **Strategy** | Event-Driven |
| **Category** | Culture |
| **Allocation** | $150 |
| **Omega** | 6.39x |
| **Shadow Omega** | 5.77x |
| **Execution Drag** | 10.0% |
| **Win Rate** | 70.8% |
| **P&L (60d)** | $5,143.68 |
| **UI P&L** | $4,452 |
| **Avg Entry Price** | 56.6% |
| **Avg Hold Time** | 213.4 hours |
| **Profile** | [View](https://polymarket.com/profile/0x8247f6d658b0afe22414a12e9f6c57058a9dd8cc) |

**Why Selected:** High shadow omega, Low execution drag, Strong win rate, Patient holding

---

### 2. 0x0213f31560df15...

| Attribute | Value |
|-----------|-------|
| **Tier** | conservative |
| **Strategy** | Event-Driven |
| **Category** | Other |
| **Allocation** | $150 |
| **Omega** | 6.74x |
| **Shadow Omega** | 6.08x |
| **Execution Drag** | 10.0% |
| **Win Rate** | 57.1% |
| **P&L (60d)** | $5,440.5 |
| **UI P&L** | $4,986 |
| **Avg Entry Price** | 18.8% |
| **Avg Hold Time** | 133.0 hours |
| **Profile** | [View](https://polymarket.com/profile/0x0213f31560df15ab7219a0cb33de0a20e445f7e3) |

**Why Selected:** High shadow omega, Low execution drag, Patient holding

---

### 3. 0x126b65f562cf1d...

| Attribute | Value |
|-----------|-------|
| **Tier** | conservative |
| **Strategy** | Mixed |
| **Category** | Sports |
| **Allocation** | $150 |
| **Omega** | 4.85x |
| **Shadow Omega** | 4.38x |
| **Execution Drag** | 10.0% |
| **Win Rate** | 80% |
| **P&L (60d)** | $1,272.29 |
| **UI P&L** | $1,283 |
| **Avg Entry Price** | 51.4% |
| **Avg Hold Time** | 77.1 hours |
| **Profile** | [View](https://polymarket.com/profile/0x126b65f562cf1d0be0a96db6be43559517bca516) |

**Why Selected:** High shadow omega, Low execution drag, Strong win rate, Patient holding

---

### 4. 0x0224bb9eb0a5c9...

| Attribute | Value |
|-----------|-------|
| **Tier** | conservative |
| **Strategy** | Mixed |
| **Category** | Other |
| **Allocation** | $150 |
| **Omega** | 2.97x |
| **Shadow Omega** | 2.68x |
| **Execution Drag** | 10.0% |
| **Win Rate** | 69% |
| **P&L (60d)** | $33,852.46 |
| **UI P&L** | $37,854 |
| **Avg Entry Price** | 56.4% |
| **Avg Hold Time** | 79.0 hours |
| **Profile** | [View](https://polymarket.com/profile/0x0224bb9eb0a5c9fd261ac9123a72cbdd5748292a) |

**Why Selected:** Low execution drag, Large P&L, Patient holding

---

### 5. 0x002dcd37b0b8fa...

| Attribute | Value |
|-----------|-------|
| **Tier** | balanced |
| **Strategy** | Generalist |
| **Category** | Unknown |
| **Allocation** | $75 |
| **Omega** | 2.52x |
| **Shadow Omega** | 2.27x |
| **Execution Drag** | 10.0% |
| **Win Rate** | 69.2% |
| **P&L (60d)** | $15,316.05 |
| **UI P&L** | $14,905 |
| **Avg Entry Price** | 48.3% |
| **Avg Hold Time** | 143.9 hours |
| **Profile** | [View](https://polymarket.com/profile/0x002dcd37b0b8fa8db98236e599fe1b90d6272561) |

**Why Selected:** Low execution drag, Large P&L, Patient holding

---

### 6. 0x010395e426e2df...

| Attribute | Value |
|-----------|-------|
| **Tier** | aggressive |
| **Strategy** | Value |
| **Category** | Politics |
| **Allocation** | $50 |
| **Omega** | 2.85x |
| **Shadow Omega** | 2.57x |
| **Execution Drag** | 10.0% |
| **Win Rate** | 70% |
| **P&L (60d)** | $2,442.72 |
| **UI P&L** | $2,256 |
| **Avg Entry Price** | 18.7% |
| **Avg Hold Time** | 392.6 hours |
| **Profile** | [View](https://polymarket.com/profile/0x010395e426e2df31b2cb0a4e1dd0e5af792c067b) |

**Why Selected:** Low execution drag, Patient holding

---

### 7. 0x133ba4d001ae33...

| Attribute | Value |
|-----------|-------|
| **Tier** | aggressive |
| **Strategy** | Value |
| **Category** | Politics |
| **Allocation** | $50 |
| **Omega** | 2.64x |
| **Shadow Omega** | 2.38x |
| **Execution Drag** | 10.0% |
| **Win Rate** | 88% |
| **P&L (60d)** | $2,350.77 |
| **UI P&L** | $2,687 |
| **Avg Entry Price** | 24.1% |
| **Avg Hold Time** | 148.5 hours |
| **Profile** | [View](https://polymarket.com/profile/0x133ba4d001ae339bfb08631eead95c5dabe92f22) |

**Why Selected:** Low execution drag, Strong win rate, Patient holding

---

### 5. 0x002dcd37b0b8fa...

| Attribute | Value |
|-----------|-------|
| **Tier** | conservative |
| **Strategy** | Generalist |
| **Category** | Unknown |
| **Allocation** | $150 |
| **Omega** | 2.52x |
| **Shadow Omega** | 2.27x |
| **Execution Drag** | 10.0% |
| **Win Rate** | 69.2% |
| **P&L (60d)** | $15,316.05 |
| **UI P&L** | $14,661 |
| **Avg Entry Price** | 48.3% |
| **Avg Hold Time** | 143.9 hours |
| **Profile** | [View](https://polymarket.com/profile/0x002dcd37b0b8fa8db98236e599fe1b90d6272561) |

**Why Selected:** Alternate for conservative tier

---

## Risk Assessment

### Execution Risks
- **Slippage**: Simulated at 0.5% entry, 0.3% exit
- **Delay**: 30-second detection and execution lag
- **Skip Rate**: Trades skipped when price moves >5%

### Portfolio Risks
- **Concentration**: Max 2 wallets per strategy, 3 per category
- **Tier Balance**: 60% conservative, 30% balanced, 10% aggressive

### Validation Notes
- 0x8247f6d6...: Validation passed
- 0x0213f315...: Validation passed
- 0x126b65f5...: Validation passed
- 0x0224bb9e...: Validation passed
- 0x002dcd37...: Validation passed
- 0x010395e4...: Validation passed
- 0x133ba4d0...: Validation passed
- 0x002dcd37...: Validation passed

---

## Appendix: Full Wallet List

| Wallet | Tier | Strategy | Omega | Shadow Ω | Alloc |
|--------|------|----------|-------|----------|-------|
| 0x8247f6d658b0... | conservative | Event-Driven | 6.39x | 5.77x | $150 |
| 0x0213f31560df... | conservative | Event-Driven | 6.74x | 6.08x | $150 |
| 0x126b65f562cf... | conservative | Mixed | 4.85x | 4.38x | $150 |
| 0x0224bb9eb0a5... | conservative | Mixed | 2.97x | 2.68x | $150 |
| 0x002dcd37b0b8... | balanced | Generalist | 2.52x | 2.27x | $75 |
| 0x010395e426e2... | aggressive | Value | 2.85x | 2.57x | $50 |
| 0x133ba4d001ae... | aggressive | Value | 2.64x | 2.38x | $50 |
| 0x002dcd37b0b8... | conservative | Generalist | 2.52x | 2.27x | $150 |

---

*Generated by Cascadian Copy-Trading Pipeline v2*
