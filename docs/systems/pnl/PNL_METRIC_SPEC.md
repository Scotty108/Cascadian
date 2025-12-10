# Cascadian PnL Metric Specification

**Version:** 1.0
**Date:** 2025-12-03
**Engine:** V17 (Frozen Canonical)
**Status:** Production

---

## Primary Metric: "Profit"

**Display Label:** Profit (or "Realized PnL")

**Formula:**
```
profit = SUM(realized_pnl) across all resolved markets

where for each (wallet, condition_id, outcome_index):
  realized_pnl = trade_cash_flow + (final_shares × resolution_price)

  trade_cash_flow = sum(sell_usdc) - sum(buy_usdc)
  final_shares    = sum(buy_tokens) - sum(sell_tokens)
  resolution_price = payout_numerators[outcome_index]  // 0 or 1
```

**Key Properties:**
- Only resolved markets contribute to Profit
- Unresolved markets contribute $0 to Profit
- Currency: USDC (or USD-equivalent)
- No "paper" profits or losses included

**UI Tooltip:**
> "Total profit from all resolved prediction markets. Unrealized gains from open positions are not included."

---

## Secondary Metric: "Open Position Value" (Optional)

**Display Label:** Open Positions (or "Unrealized PnL")

**Formula:**
```
open_position_value = SUM(unrealized_pnl) across all unresolved markets

where for each (wallet, condition_id, outcome_index):
  unrealized_pnl = trade_cash_flow + (final_shares × mark_price)

  mark_price = 0.5  // conservative mid-point valuation
```

**Key Properties:**
- Only unresolved markets contribute
- Uses 0.5 as mark price (conservative estimate)
- Represents potential value, not guaranteed profit

**UI Tooltip:**
> "Estimated value of open positions at $0.50 per share. Actual value depends on market resolution."

---

## Tertiary Metric: "Total PnL" (Optional)

**Display Label:** Total PnL

**Formula:**
```
total_pnl = profit + open_position_value
          = realized_pnl + unrealized_pnl
```

**When to show:** Only if explicitly requested. Not recommended as primary metric.

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Unresolved market | realized_pnl = 0, contributes to unrealized only |
| Market resolved to 0 or 1 | Standard formula applies |
| Partial resolution (future) | Not currently supported |
| Fee deductions | Included in trade_cash_flow (via usdc amounts) |
| Split/merge CTF events | Handled at trade level, transparent to PnL |

---

## Time Windows

The Profit metric can be computed for different time windows:

| Window | Description |
|--------|-------------|
| Lifetime | All-time profit (default) |
| 30 days | Profit from markets resolved in last 30 days |
| 7 days | Profit from markets resolved in last 7 days |
| Custom | Profit between specified dates |

**Implementation:** Filter by `resolution_time` in the query.

---

## Data Sources

| Source | Priority | Description |
|--------|----------|-------------|
| ClickHouse tables | 1 (highest) | pm_cascadian_pnl_v17, pm_trader_events_v2 |
| V17 Engine | 2 | lib/pnl/uiActivityEngineV17.ts |
| Benchmarks | 3 | pm_ui_pnl_benchmarks_v1 |
| Polymarket UI | 4 (reference only) | Used for sanity checks, not as target |

---

## Validation Criteria

### Acceptance Thresholds

| Wallet Type | Error vs UI | Sign Match |
|-------------|-------------|------------|
| Smart Money (>$100K profit) | <25% median | 100% |
| Medium ($1K-$100K) | <30% median | >95% |
| Retail (<$1K) | <50% median | >90% |

**Note:** UI error is computed against fresh benchmark snapshots, not stale data.

### Automatic Alerts

Flag for investigation if:
- Sign flip between V17 and UI benchmark
- Error >100% for any smart money wallet
- Sudden change >$10K in single wallet's realized PnL

---

## API Response Format

```typescript
interface WalletPnL {
  wallet: string;
  profit: number;              // realized_pnl, primary metric
  open_position_value: number; // unrealized_pnl, optional
  total_pnl: number;           // profit + open_position_value

  markets_resolved: number;    // count of resolved markets
  markets_open: number;        // count of unresolved markets

  computed_at: string;         // ISO timestamp
  engine_version: string;      // "V17"
}
```

---

## Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2025-12-03 | Initial spec based on V17 investigation |

---

*Spec authored based on V17 UI Parity Investigation findings.*
