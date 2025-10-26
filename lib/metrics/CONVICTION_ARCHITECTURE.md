# Directional Conviction Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    DIRECTIONAL CONVICTION SYSTEM                     │
│                  (Austin's TSI Momentum Strategy)                    │
└─────────────────────────────────────────────────────────────────────┘

                              ┌──────────────┐
                              │   Market     │
                              │  (Polymarket)│
                              └──────┬───────┘
                                     │
                         ┌───────────┴───────────┐
                         │                       │
                    ┌────▼────┐            ┌────▼────┐
                    │ ClickHouse│          │ Supabase │
                    │ (Trades)  │          │(Metadata)│
                    └────┬────┘            └────┬────┘
                         │                      │
        ┌────────────────┴────────┬─────────────┴─────────────┐
        │                         │                           │
   ┌────▼────────┐         ┌─────▼──────┐          ┌────────▼────────┐
   │Elite Wallets│         │Recent      │          │Category         │
   │(Ω > 2.0)    │         │Positions   │          │Specialists      │
   │≥10 trades   │         │(24h)       │          │(tagged)         │
   └────┬────────┘         └─────┬──────┘          └────────┬────────┘
        │                        │                           │
        └────────────┬───────────┴────────┬──────────────────┘
                     │                    │
              ┌──────▼──────┐      ┌──────▼──────┐
              │  Component  │      │  Component  │
              │ Calculations│      │   Scoring   │
              └──────┬──────┘      └──────┬──────┘
                     │                    │
                     └──────────┬─────────┘
                                │
                        ┌───────▼────────┐
                        │ Weighted       │
                        │ Conviction     │
                        │ Score (0-1)    │
                        └───────┬────────┘
                                │
                      ┌─────────▼──────────┐
                      │ Entry Threshold    │
                      │ Check (>= 0.9)     │
                      └─────────┬──────────┘
                                │
                    ┌───────────┴────────────┐
                    │                        │
             ┌──────▼──────┐        ┌───────▼────────┐
             │TSI Crossover│        │ Signal Storage │
             │Integration  │        │ (ClickHouse)   │
             └──────┬──────┘        └────────────────┘
                    │
            ┌───────▼────────┐
            │ENTRY/EXIT/HOLD │
            │    Signal      │
            └────────────────┘
```

## Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                        CONVICTION CALCULATION FLOW                    │
└──────────────────────────────────────────────────────────────────────┘

INPUT:
┌─────────────────────┐
│ marketId            │
│ conditionId         │
│ side (YES/NO)       │
│ lookbackHours (24)  │
└──────────┬──────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│ STEP 1: Fetch Elite Wallets                                          │
│                                                                       │
│ Query: wallet_metrics_complete                                       │
│ Filter: metric_2_omega_net > 2.0 AND metric_22_resolved_bets >= 10  │
│                                                                       │
│ Result: Map<wallet_address, omega_score>                            │
└──────────┬────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│ STEP 2: Fetch Recent Positions                                       │
│                                                                       │
│ Query: trades_raw                                                    │
│ Filter: condition_id = ? AND timestamp >= now() - ? hours            │
│ Join: WITH elite_wallets (from Step 1)                              │
│                                                                       │
│ Result: Array<{wallet, side, omega}>                                │
└──────────┬────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│ STEP 3: Get Market Category & Fetch Specialists                      │
│                                                                       │
│ Query: markets → category                                            │
│ Query: wallet_category_tags                                          │
│ Filter: category = ? AND is_likely_specialist = true                │
│                                                                       │
│ Result: Map<wallet_address, category_omega>                         │
└──────────┬────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│ STEP 4: Calculate Component Scores                                   │
│                                                                       │
│ A) Elite Consensus                                                   │
│    elite_on_side / total_elite                                       │
│    → elite_consensus_pct (0-1)                                       │
│                                                                       │
│ B) Category Specialist Consensus                                     │
│    specialists_on_side / total_specialists                           │
│    → specialist_consensus_pct (0-1)                                  │
│    [Falls back to elite_consensus if no specialists]                 │
│                                                                       │
│ C) Omega-Weighted Consensus                                          │
│    sum(omega for side) / sum(all omega)                             │
│    → omega_weighted_pct (0-1)                                        │
└──────────┬────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│ STEP 5: Combine into Final Score                                     │
│                                                                       │
│ directional_conviction =                                             │
│   0.50 × elite_consensus_pct      +                                 │
│   0.30 × specialist_consensus_pct +                                 │
│   0.20 × omega_weighted_pct                                         │
│                                                                       │
│ meets_threshold = (conviction >= 0.9)                               │
└──────────┬────────────────────────────────────────────────────────────┘
           │
           ▼
OUTPUT:
┌─────────────────────────────────────────────┐
│ ConvictionResult {                          │
│   directionalConviction: 0.0-1.0           │
│   eliteConsensusPct: 0.0-1.0               │
│   categorySpecialistPct: 0.0-1.0           │
│   omegaWeightedConsensus: 0.0-1.0          │
│   meetsEntryThreshold: boolean             │
│   eliteWalletsCount: number                │
│   eliteWalletsOnSide: number               │
│   specialistsCount: number                 │
│   specialistsOnSide: number                │
│   totalOmegaWeight: number                 │
│   timestamp: Date                          │
│   marketId: string                         │
│   conditionId: string                      │
│   side: 'YES' | 'NO'                       │
│ }                                           │
└─────────────────────────────────────────────┘
```

## Component Weight Distribution

```
┌──────────────────────────────────────────────────────────────┐
│           CONVICTION SCORE COMPOSITION (100%)                 │
└──────────────────────────────────────────────────────────────┘

                     Final Conviction Score
                            (0-1)
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────▼─────┐         ┌────▼─────┐         ┌────▼─────┐
   │  Elite   │         │Category  │         │  Omega   │
   │Consensus │         │Specialist│         │ Weighted │
   │  (50%)   │         │  (30%)   │         │  (20%)   │
   └──────────┘         └──────────┘         └──────────┘
        │                     │                     │
        │                     │                     │
   ┌────▼─────┐         ┌────▼─────┐         ┌────▼─────┐
   │ Wallets  │         │Specialist│         │  Omega   │
   │on side / │         │on side / │         │  side /  │
   │  total   │         │  total   │         │  total   │
   └──────────┘         └──────────┘         └──────────┘

   Example:                Example:             Example:
   7/8 = 0.875            4/5 = 0.80           7.8/10.1 = 0.772

   0.875 × 0.5 = 0.4375   0.80 × 0.3 = 0.24   0.772 × 0.2 = 0.1544

   Final = 0.4375 + 0.24 + 0.1544 = 0.832 (83.2%)
```

## Integration with TSI

```
┌──────────────────────────────────────────────────────────────┐
│          TSI + CONVICTION SIGNAL GENERATION                   │
└──────────────────────────────────────────────────────────────┘

        ┌──────────────┐              ┌──────────────┐
        │ Price History│              │  Elite Wallet│
        │ (10s snaps)  │              │  Positions   │
        └──────┬───────┘              └──────┬───────┘
               │                             │
          ┌────▼────┐                   ┌────▼────┐
          │   TSI   │                   │Conviction│
          │Calculator│                  │Calculator│
          └────┬────┘                   └────┬────┘
               │                             │
          ┌────▼──────────┐            ┌────▼──────────┐
          │ TSI Result    │            │Conviction     │
          │ - Fast: 45.2  │            │Result         │
          │ - Slow: 38.1  │            │ - Score: 0.92 │
          │ - Signal:     │            │ - Meets: true │
          │   BULLISH     │            │ - Elite: 0.90 │
          └────┬──────────┘            └────┬──────────┘
               │                             │
               └──────────┬──────────────────┘
                          │
                   ┌──────▼───────┐
                   │Signal Logic  │
                   └──────┬───────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
   ┌────▼────┐       ┌────▼────┐      ┌────▼────┐
   │ ENTRY   │       │  EXIT   │      │  HOLD   │
   │ Signal  │       │ Signal  │      │ Signal  │
   └─────────┘       └─────────┘      └─────────┘

   Condition:        Condition:       Condition:
   TSI BULLISH       TSI BEARISH      TSI NEUTRAL
   AND               (regardless of   OR
   Conviction >= 0.9 conviction)      Conviction < 0.9
```

## Database Schema Reference

```
┌──────────────────────────────────────────────────────────────┐
│                    CLICKHOUSE TABLES                          │
└──────────────────────────────────────────────────────────────┘

wallet_metrics_complete
├─ wallet_address (String)
├─ window (Enum: '30d', '90d', '180d', 'lifetime')
├─ metric_2_omega_net (Decimal) ← ELITE FILTER
├─ metric_22_resolved_bets (UInt32) ← ELITE FILTER
└─ ... 100 other metrics

trades_raw
├─ trade_id (String)
├─ wallet_address (String)
├─ market_id (String)
├─ condition_id (String) ← JOIN KEY
├─ timestamp (DateTime) ← LOOKBACK FILTER
├─ side (Enum: 'YES', 'NO') ← CONSENSUS CALC
├─ is_closed (Bool)
└─ ... other fields

momentum_trading_signals (OUTPUT)
├─ signal_id (String)
├─ market_id (String)
├─ signal_timestamp (DateTime)
├─ signal_type (Enum: 'ENTRY', 'EXIT', 'HOLD')
├─ directional_conviction (Decimal)
├─ elite_consensus_pct (Decimal)
├─ category_specialist_pct (Decimal)
├─ omega_weighted_consensus (Decimal)
├─ elite_wallets_yes (UInt16)
├─ elite_wallets_no (UInt16)
├─ elite_wallets_total (UInt16)
├─ meets_entry_threshold (Boolean)
└─ ... TSI fields


┌──────────────────────────────────────────────────────────────┐
│                     SUPABASE TABLES                           │
└──────────────────────────────────────────────────────────────┘

markets
├─ market_id (text)
├─ condition_id (text) ← JOIN KEY
├─ category (text) ← SPECIALIST FILTER
└─ ... other fields

wallet_category_tags
├─ wallet_address (text)
├─ category (text) ← CATEGORY MATCH
├─ category_omega (decimal) ← SPECIALIST FILTER
├─ is_likely_specialist (boolean) ← SPECIALIST FILTER
└─ ... other fields
```

## Edge Case Decision Tree

```
┌──────────────────────────────────────────────────────────────┐
│              EDGE CASE HANDLING LOGIC                         │
└──────────────────────────────────────────────────────────────┘

                  Calculate Conviction
                         │
                         ▼
              ┌──────────────────────┐
              │ Fetch Elite Wallets  │
              └──────────┬───────────┘
                         │
              ┌──────────▼──────────┐
              │ Elite wallets > 0?  │
              └──────────┬───────────┘
                         │
         ┌───────────────┴────────────────┐
         │ NO                             │ YES
         ▼                                ▼
┌────────────────┐              ┌─────────────────┐
│Return Neutral: │              │Fetch Positions  │
│- conviction:0.5│              └────────┬────────┘
│- threshold:false│                      │
└────────────────┘               ┌───────▼────────┐
                                │ Positions > 0?  │
                                └───────┬─────────┘
                                        │
                        ┌───────────────┴────────────┐
                        │ NO                         │ YES
                        ▼                            ▼
                ┌────────────────┐          ┌───────────────┐
                │Return Neutral  │          │Get Category   │
                └────────────────┘          └───────┬───────┘
                                                    │
                                            ┌───────▼────────┐
                                            │ Category exists?│
                                            └───────┬─────────┘
                                                    │
                            ┌───────────────────────┴───────────────┐
                            │ NO                                    │ YES
                            ▼                                       ▼
                    ┌───────────────┐                   ┌──────────────────┐
                    │Skip Specialist│                   │Fetch Specialists │
                    │Component      │                   └────────┬─────────┘
                    │(use elite)    │                            │
                    └───────┬───────┘                    ┌───────▼────────┐
                            │                            │Specialists > 0? │
                            │                            └───────┬─────────┘
                            │                                    │
                            │                    ┌───────────────┴──────────┐
                            │                    │ NO                       │ YES
                            │                    ▼                          ▼
                            │            ┌───────────────┐         ┌────────────┐
                            │            │Use Elite      │         │Calculate   │
                            │            │Consensus      │         │Specialist  │
                            │            │for Specialist │         │Consensus   │
                            │            └───────┬───────┘         └─────┬──────┘
                            │                    │                       │
                            └────────────────────┴───────────────────────┘
                                                 │
                                        ┌────────▼────────┐
                                        │Calculate Scores │
                                        └────────┬────────┘
                                                 │
                                        ┌────────▼────────┐
                                        │Combine Weighted │
                                        └────────┬────────┘
                                                 │
                                        ┌────────▼────────┐
                                        │Return Result    │
                                        └─────────────────┘
```

## Performance Optimization Strategy

```
┌──────────────────────────────────────────────────────────────┐
│                  OPTIMIZATION LAYERS                          │
└──────────────────────────────────────────────────────────────┘

Layer 1: Query Optimization
├─ Elite wallet query: Indexed on omega, window
├─ Position query: Partitioned by month, indexed on wallet
├─ Specialist query: Indexed on category, is_likely_specialist
└─ Use ROW_NUMBER() to get latest position per wallet

Layer 2: Caching
├─ Elite wallet list: Cache for 5 minutes
│  └─ Reduces DB hits for batch processing
├─ Category specialists: Cache per category
│  └─ Most markets in same categories
└─ Market categories: Cache with TTL

Layer 3: Batch Processing
├─ Process 5 markets in parallel (configurable)
├─ Reuse elite wallet query across batch
├─ Promise.allSettled for fault tolerance
└─ Graceful degradation on failures

Layer 4: Connection Pooling
├─ ClickHouse client reuses connections
├─ Supabase admin client persistent
└─ Avoid creating new clients per request
```

---

**Version:** 1.0
**Author:** Claude (Sonnet 4.5)
**Date:** 2025-10-25
