# V3 Wallet Metrics API Schema

**Date:** 2025-11-30
**Status:** Proposed
**Engine:** `lib/pnl/uiActivityEngineV3.ts`

---

## Overview

This document defines the JSON schema for wallet metrics using the V3 PnL engine. The schema is designed to:

1. Expose V3 PnL with full source breakdown
2. Provide quality indicators so consumers know confidence level
3. Support both summary and detailed views
4. Enable future engine versions without breaking changes

---

## API Endpoints

### GET /api/wallet/{address}/metrics

Returns full wallet metrics including V3 PnL breakdown.

### GET /api/wallet/{address}/pnl

Returns just the PnL section (lighter payload).

### GET /api/leaderboard

Returns ranked list of wallets with V3 metrics.

---

## Response Schema

### Full Wallet Metrics Response

```typescript
interface WalletMetricsResponse {
  // Identification
  wallet_address: string;              // Lowercase, no 0x prefix

  // Timestamp
  computed_at: string;                 // ISO 8601 timestamp
  data_freshness: 'realtime' | 'cached' | 'stale';
  cache_age_seconds?: number;

  // V3 PnL (primary)
  pnl: {
    version: 'v3';

    // Total estimated PnL
    total_usd: number;                 // e.g., 22053934.50
    total_formatted: string;           // e.g., "$22.05M"

    // Source breakdown
    sources: {
      clob_usd: number;                // From CLOB trading
      redemptions_usd: number;         // From PayoutRedemptions
      resolution_usd: number;          // From unredeemed resolved positions
    };

    // Quality indicators
    quality: 'high' | 'medium' | 'low';
    quality_factors: {
      resolution_dependency_pct: number;  // 0-100, lower is better
      trade_count: number;
      has_complex_events: boolean;        // Splits/merges present
    };

    // Confidence interval (optional)
    confidence?: {
      lower_bound_usd: number;         // e.g., total * 0.85
      upper_bound_usd: number;         // e.g., total * 1.15
      method: string;                  // e.g., "historical_error_distribution"
    };
  };

  // Trading activity
  activity: {
    total_volume_usd: number;
    trade_count: number;
    markets_traded: number;
    first_trade_at: string;            // ISO 8601
    last_trade_at: string;             // ISO 8601
    active_positions: number;
  };

  // Performance metrics
  performance: {
    win_rate?: number;                 // 0-1, resolved markets only
    markets_won: number;
    markets_lost: number;
    markets_active: number;
    roi_pct?: number;                  // PnL / total_invested
  };

  // Metadata
  meta: {
    is_smart_money: boolean;
    labels: string[];                  // e.g., ["whale", "sports-specialist"]
  };
}
```

### Lightweight PnL Response

```typescript
interface WalletPnLResponse {
  wallet_address: string;
  computed_at: string;

  pnl: {
    version: 'v3';
    total_usd: number;
    total_formatted: string;
    quality: 'high' | 'medium' | 'low';
    resolution_dependency_pct: number;
  };

  // Source breakdown (optional, include via ?include_sources=true)
  sources?: {
    clob_usd: number;
    redemptions_usd: number;
    resolution_usd: number;
  };
}
```

### Leaderboard Response

```typescript
interface LeaderboardResponse {
  generated_at: string;
  total_wallets: number;
  page: number;
  per_page: number;

  wallets: Array<{
    rank: number;
    wallet_address: string;

    pnl: {
      version: 'v3';
      total_usd: number;
      total_formatted: string;
      quality: 'high' | 'medium' | 'low';
    };

    // Summary stats
    volume_usd: number;
    trade_count: number;
    win_rate?: number;

    // Flags
    is_smart_money: boolean;
  }>;
}
```

---

## Quality Scoring Logic

### Definition

```typescript
function computeQuality(
  resolutionDependencyPct: number,
  volumeUsd: number,
  hasComplexEvents: boolean
): 'high' | 'medium' | 'low' {

  // High quality: low resolution dependency, meaningful volume
  if (resolutionDependencyPct < 30 && volumeUsd > 10_000) {
    return 'high';
  }

  // Low quality: very high resolution dependency
  if (resolutionDependencyPct > 80) {
    return 'low';
  }

  // Low quality: complex events that may cause errors
  if (hasComplexEvents && resolutionDependencyPct > 50) {
    return 'low';
  }

  // Medium: everything else
  return 'medium';
}
```

### What Quality Means

| Quality | Expected Error | Recommended Use |
|---------|----------------|-----------------|
| **high** | <10% | Show exact value |
| **medium** | 10-25% | Show with "~" prefix |
| **low** | >25% | Show as "Est." or range |

---

## Display Guidelines

### Formatting Total PnL

```typescript
function formatPnL(usd: number, quality: string): string {
  const abs = Math.abs(usd);
  const sign = usd >= 0 ? '' : '-';

  let formatted: string;
  if (abs >= 1_000_000) {
    formatted = `$${(abs / 1_000_000).toFixed(2)}M`;
  } else if (abs >= 1_000) {
    formatted = `$${(abs / 1_000).toFixed(1)}K`;
  } else {
    formatted = `$${abs.toFixed(2)}`;
  }

  // Add prefix based on quality
  switch (quality) {
    case 'high':
      return `${sign}${formatted}`;
    case 'medium':
      return `~${sign}${formatted}`;
    case 'low':
      return `Est. ${sign}${formatted}`;
  }
}
```

### UI Tooltip Content

For the PnL display, show this tooltip on hover:

> **Estimated PnL**
>
> Computed from on-chain trades, redemptions, and market resolutions.
>
> **Sources:**
> - Trading: $X
> - Redemptions: $Y
> - Resolution: $Z
>
> **Quality:** [High/Medium/Low]
> - Resolution dependency: X%
>
> Usually within 10-20% of Polymarket's display.

---

## Example Responses

### High-Quality Wallet

```json
{
  "wallet_address": "0x7f3c8979d0afa00007bae4747d5347122af05613",
  "computed_at": "2025-11-30T10:30:00Z",
  "data_freshness": "realtime",

  "pnl": {
    "version": "v3",
    "total_usd": 183340.50,
    "total_formatted": "$183.3K",

    "sources": {
      "clob_usd": 165000.00,
      "redemptions_usd": 15000.00,
      "resolution_usd": 3340.50
    },

    "quality": "high",
    "quality_factors": {
      "resolution_dependency_pct": 1.8,
      "trade_count": 2450,
      "has_complex_events": false
    }
  },

  "activity": {
    "total_volume_usd": 5200000,
    "trade_count": 2450,
    "markets_traded": 156,
    "first_trade_at": "2024-03-15T08:00:00Z",
    "last_trade_at": "2025-11-30T09:45:00Z",
    "active_positions": 23
  },

  "performance": {
    "win_rate": 0.62,
    "markets_won": 89,
    "markets_lost": 54,
    "markets_active": 13
  },

  "meta": {
    "is_smart_money": true,
    "labels": ["consistent-winner", "high-volume"]
  }
}
```

### Medium-Quality Wallet (High Resolution Dependency)

```json
{
  "wallet_address": "0x56687bf447db6ffa42ffe2204a05edaa20f55839",
  "computed_at": "2025-11-30T10:30:00Z",
  "data_freshness": "realtime",

  "pnl": {
    "version": "v3",
    "total_usd": 25000000.00,
    "total_formatted": "~$25.00M",

    "sources": {
      "clob_usd": 8500000.00,
      "redemptions_usd": 3200000.00,
      "resolution_usd": 13300000.00
    },

    "quality": "medium",
    "quality_factors": {
      "resolution_dependency_pct": 53.2,
      "trade_count": 45000,
      "has_complex_events": true
    },

    "confidence": {
      "lower_bound_usd": 21250000,
      "upper_bound_usd": 28750000,
      "method": "historical_error_distribution"
    }
  },

  "activity": {
    "total_volume_usd": 150000000,
    "trade_count": 45000,
    "markets_traded": 1200,
    "first_trade_at": "2023-01-05T12:00:00Z",
    "last_trade_at": "2025-11-30T10:15:00Z",
    "active_positions": 85
  },

  "performance": {
    "win_rate": 0.71,
    "markets_won": 756,
    "markets_lost": 310,
    "markets_active": 134
  },

  "meta": {
    "is_smart_money": true,
    "labels": ["whale", "theo4", "top-10"]
  }
}
```

---

## Database Schema

### ClickHouse Table: `pm_wallet_metrics_v3`

```sql
CREATE TABLE pm_wallet_metrics_v3 (
  wallet_address      LowCardinality(String),
  computed_at         DateTime64(3),

  -- V3 PnL
  pnl_total_usd       Decimal(18,2),
  pnl_clob_usd        Decimal(18,2),
  pnl_redemptions_usd Decimal(18,2),
  pnl_resolution_usd  Decimal(18,2),

  -- Quality
  resolution_dependency_pct Float32,
  pnl_quality         Enum8('high' = 1, 'medium' = 2, 'low' = 3),
  has_complex_events  UInt8,

  -- Activity
  total_volume_usd    Decimal(18,2),
  trade_count         UInt32,
  markets_traded      UInt32,
  first_trade_at      DateTime64(3),
  last_trade_at       DateTime64(3),
  active_positions    UInt16,

  -- Performance
  win_rate            Nullable(Float32),
  markets_won         UInt32,
  markets_lost        UInt32,

  -- Metadata
  is_smart_money      UInt8,
  labels              Array(LowCardinality(String)),

  -- Versioning
  version             UInt8 DEFAULT 3,
  is_deleted          UInt8 DEFAULT 0
)
ENGINE = ReplacingMergeTree(computed_at)
ORDER BY (wallet_address)
SETTINGS index_granularity = 8192;
```

---

## Migration Path

### From Current State

1. **Phase 1**: Add V3 columns to existing wallet tables (non-breaking)
2. **Phase 2**: Populate V3 metrics for all tracked wallets
3. **Phase 3**: Update API endpoints to include V3 response
4. **Phase 4**: Update UI to display V3 with quality indicators
5. **Phase 5**: Deprecate old PnL fields (soft deprecation with warnings)

### Future V4

When implementing FIFO cost basis (V4), the schema supports:

```typescript
pnl: {
  version: 'v4',  // Or include both
  // ... same structure
}
```

API can support version selection via query param: `?pnl_version=v3` or `?pnl_version=v4`.

---

## Error Handling

### No Data

```json
{
  "wallet_address": "0x...",
  "error": {
    "code": "NO_DATA",
    "message": "No trading activity found for this wallet"
  }
}
```

### Computation Timeout

```json
{
  "wallet_address": "0x...",
  "error": {
    "code": "TIMEOUT",
    "message": "PnL computation timed out. Try again or use cached value.",
    "cached_value": {
      "total_usd": 150000,
      "computed_at": "2025-11-29T00:00:00Z",
      "quality": "stale"
    }
  }
}
```

---

*Schema designed by Claude Code - 2025-11-30*
*Signed: Claude 1*
