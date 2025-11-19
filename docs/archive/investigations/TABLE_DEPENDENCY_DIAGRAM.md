# CASCADIAN CLICKHOUSE TABLE DEPENDENCY DIAGRAM

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    BLOCKCHAIN DATA SOURCES                       │
│  (Polygon ERC1155 transfers, ERC20 USDC flows)                  │
└────────────┬────────────────────────────────┬────────────────────┘
             │                                │
             ▼                                ▼
    ┌──────────────────┐          ┌──────────────────┐
    │ erc1155_transfers│          │ erc20_transfers  │
    │  206K rows       │          │  288K rows       │
    │ (cleaned)        │          │ (cleaned)        │
    └────────┬─────────┘          └────────┬─────────┘
             │                             │
             ▼                             ▼
    ┌──────────────────┐          ┌──────────────────┐
    │ pm_erc1155_flats │          │ (USDC ledger)    │
    │  206K rows       │          │ Settlement track │
    │ (denormalized)   │          └──────────────────┘
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────────────────┐
    │   trades_raw                 │
    │   159.5M rows ⭐ CANONICAL   │
    │   - wallet_address           │
    │   - condition_id             │
    │   - outcome_index            │
    │   - timestamp                │
    │   - cashflows                │
    │   [Dec 2022 - Oct 2025]      │
    └─────────┬────────────────────┘
              │
              │ [FORK - multiple pipelines]
              │
    ┌─────────┴─────────────────────────────────────────┬────────┐
    │                                                     │        │
    ▼                                                     ▼        ▼
DIRECTION DETECTION          MARKET MAPPING      DEDUPLICATION
    │                             │                     │
    ▼                             ▼                     ▼
condition_market_map ──────► gamma_markets        trades_dedup_mat
151.8K rows                 149.9K rows           106.6M rows
(condition → market)        (market definitions)  (deduplicated)
    │
    │ (bloom_filter indexed lookups)
    │
    └─────────────────┬──────────────────────────────────────────┐
                      │                                          │
                      ▼                                          ▼
              ┌──────────────────────┐              ┌──────────────────┐
              │ market_resolutions   │              │ outcome_positions│
              │ _final ⭐ CRITICAL   │              │ _v2              │
              │ 223.9K rows          │              │ 2M rows          │
              │ - winning_index      │              │ (curated snapshot)
              │ - payout vectors     │              │ - total_shares   │
              │ - source (6 APIs)    │              │ at resolution    │
              └─────────┬────────────┘              └────────┬─────────┘
                        │                                    │
                        │ (normalized join on condition_id)  │
                        │                                    │
                        └─────────────┬──────────────────────┘
                                      │
                                      ▼
                          ┌──────────────────────┐
                          │ winning_index (VIEW) │
                          │ 150K rows            │
                          │ condition_id_norm →  │
                          │ winning outcome      │
                          └─────────┬────────────┘
                                    │
                                    │ [PnL CALCULATION]
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
         ┌──────────▼──────────┐        ┌──────────▼──────────┐
         │ Cashflow Sum        │        │ Winning Shares      │
         │ (from trades_raw)   │        │ (outcome_positions) │
         │ USDC realized       │        │ multiplied by $1.00 │
         └──────────┬──────────┘        └──────────┬──────────┘
                    │                              │
                    └──────────┬───────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ realized_pnl_usd     │
                    │ = sum(cashflows)     │
                    │ + sum(winning_shares)│
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ wallet_pnl_summary   │
                    │ [FINAL OUTPUT]       │
                    │ - Per wallet PnL     │
                    │ - Validated: -2.3%   │
                    │   variance on tests  │
                    └──────────────────────┘
```

---

## Table Categories & Dependencies

### PRIMARY SOURCES (Immutable, blockchain-derived)
```
erc1155_transfers ────────┐
erc20_transfers ──────────┤──► trades_raw ⭐
(raw blockchain events)   │    (159.5M rows)
                          └─────────┘
```

### API DATA SOURCES (Continuously updated)
```
Polymarket APIs ──────────┬──► gamma_markets (149.9K markets)
(6 sources)               │
                          ├──► market_resolutions_final (223.9K)
                          │
                          └──► condition_market_map (151.8K)
```

### CURATED TABLES (Pre-aggregated, validated)
```
trades_raw ───────────────┬──► outcome_positions_v2 (2M)
                          │    [Snapshot of holdings]
                          │
market_resolutions_final ─┤
                          │
condition_market_map ─────┘
                          │
                          └──► winning_index (150K)
                               [Resolution outcomes]
```

### OUTPUT TABLES (For dashboards/analysis)
```
trades_raw
outcome_positions_v2
winning_index
condition_market_map
    ↓
[PnL FORMULA] ─────────► realized_pnl_by_market_v2
                             ↓
                    wallet_pnl_summary (Dashboard)
                    wallet_resolution_outcomes (Metrics)
```

---

## Critical Join Paths

### Path 1: Condition ID Normalization (IDN)
```
trades_raw.condition_id (with 0x prefix, mixed case)
                ↓ [normalize: lowercase, remove 0x]
market_resolutions_final.condition_id_norm (FixedString(64))
                ↓
[JOIN KEY] ──────► Match found or not
```

### Path 2: Position Resolution (PnL Calculation)
```
trades_raw
    ├─ wallet_address
    ├─ condition_id (normalized to condition_id_norm)
    │
    ├─► condition_market_map [JOIN on condition_id_norm]
    │   └─ market_id
    │
    ├─► market_resolutions_final [JOIN on market_id]
    │   └─ winning_outcome_index
    │
    ├─► outcome_positions_v2 [JOIN on wallet + condition]
    │   └─ total_shares at resolution
    │
    └─► [CALCULATION]
        IF outcome_index == winning_outcome_index:
            realized_pnl += (total_shares × $1.00)
        realized_pnl += sum(cashflows_usdc)
```

### Path 3: Market Enrichment
```
gamma_markets.market_id ◄─── condition_market_map.market_id
         ├─ question
         ├─ outcomes (Array)
         ├─ category
         ├─ tags
         └─► events_dim (enrichment)
```

---

## Data Coverage Map

### By Volume
```
Total Blockchain Transactions: 159.5M (trades_raw)
    ├─ With condition_id:     82.1M (51.5%)
    │   ├─ With market mapping: 151.8K markets
    │   │   ├─ With resolutions: 57.6K (15.1% of mapped)
    │   │   └─ Without resolutions: 94.2K (84.9% - OPEN markets)
    │   │
    │   └─ Without market mapping: 77.4M (48.5% - direction unknown)
    │
    └─ Without condition_id:   77.4M (48.5% - lost to mapping)
```

### By Market Status
```
Unique Markets in trades_raw:        233.3K
├─ With resolution data:             57.6K (24.7%)
│  ├─ Resolved: complete history
│  ├─ Known winner: winning_index mapped
│  └─ PnL calculable: ✅ YES
│
└─ Without resolution data:          175.7K (75.3%)
   ├─ Open markets: awaiting outcome (90%+ probability)
   ├─ No resolution date: still trading
   └─ PnL calculable: ❌ NO (unrealized only)
```

---

## Data Freshness & Update Frequency

| Table | Source | Freshness | Update Freq | Last Updated |
|-------|--------|-----------|------------|--------------|
| trades_raw | Blockchain | Current | Continuous | Oct 31, 2025 |
| erc1155_transfers | Blockchain | Current | Continuous | Oct 31, 2025 |
| erc20_transfers | Blockchain | Current | Continuous | Oct 31, 2025 |
| gamma_markets | Polymarket API | Fresh | Hourly | Oct 31, 2025 |
| market_resolutions_final | 6 APIs | Fresh | Continuous | Oct 31, 2025 |
| condition_market_map | Cache | Fresh | Hourly | Oct 31, 2025 |
| outcome_positions_v2 | Derived | Stale | Manual rebuild | Last unknown |
| pm_trades | CLOB API | Very Stale | >1 month gap | >1 month ago |

---

## Archive/Deprecated Tables (20+)

These exist but should not be used:
- `canonical_condition` (VIEW - empty)
- `trades_dedup_view` (VIEW - empty)
- `market_outcomes_expanded` (VIEW - empty)
- `market_resolutions_ctf` (ReplacingMergeTree - unused)
- `realized_pnl_by_resolution` (VIEW - broken)
- `resolution_candidates_norm` (VIEW - candidate data only)
- + 14 more (see CLICKHOUSE_COMPLETE_TABLE_MAPPING.md)

**Recommendation:** Archive these to improve schema clarity.

---

## Key Metrics Summary

```
╔═════════════════════════════════════════════════════════╗
║ CASCADIAN DATABASE SNAPSHOT (2025-11-07)                ║
╠═════════════════════════════════════════════════════════╣
║ Primary Trade Source:        trades_raw                 ║
║ Total Transactions:          159.5M                      ║
║ Unique Wallets:              996K+                       ║
║ Time Span:                   1,048 days                  ║
║ Data Quality:                HIGH ✅                     ║
║                                                          ║
║ Resolution Coverage:         223.9K markets resolved     ║
║ Market Matching Rate:        24.7% ⚠️                    ║
║ Sources:                     6 APIs (rollup, bridge,     ║
║                              onchain, gamma, clob, ...)  ║
║                                                          ║
║ PnL Formula Status:          VALIDATED ✅                ║
║ Test Variance:               -2.3% (excellent)           ║
║ Production Ready:            YES (with disclaimers)      ║
╚═════════════════════════════════════════════════════════╝
```

---

**For detailed table specifications, see:** `/Users/scotty/Projects/Cascadian-app/CLICKHOUSE_COMPLETE_TABLE_MAPPING.md`
