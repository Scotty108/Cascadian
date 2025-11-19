# Copy Trading Modes - Complete Architecture

## Overview

This document defines the 6 copy trading modes supported by the platform. Each mode represents a different strategy for copying trades from elite wallets.

---

## Copy Trading Mode Schema

```typescript
copy_trading: {
  enabled: boolean;
  mode: 'MIRROR_ALL' | 'CONSENSUS_ONLY' | 'TOP_PERFORMER' | 'WEIGHTED' | 'TIER_BASED' | 'HYBRID';

  // Common settings (all modes)
  poll_interval_seconds: number;
  max_latency_seconds: number;

  // Mode-specific settings
  mode_config: {
    // CONSENSUS_ONLY settings
    owrr_thresholds?: {
      min_yes: number;        // e.g., 0.65
      min_no: number;         // e.g., 0.60
      min_confidence: string; // 'low' | 'medium' | 'high'
    };

    // WEIGHTED settings
    weight_metric?: 'omega' | 'win_rate' | 'roi' | 'sharpe';

    // TIER_BASED settings
    tiers?: {
      tier1: { size: number; rule: 'copy_all' | 'consensus' };
      tier2: { size: number; rule: 'copy_all' | 'consensus' };
      tier3: { size: number; rule: 'copy_all' | 'consensus' };
    };

    // HYBRID settings
    hybrid_rules?: {
      top_n_copy_all: number;        // e.g., 10 (copy all trades from top 10)
      others_consensus_min: number;  // e.g., 2 (need 2+ wallets to agree for others)
    };
  };

  // Detection settings (what to monitor)
  detection: {
    monitor_new_positions: boolean;
    monitor_position_increases: boolean;
    monitor_exits: boolean;
    grouping_window_seconds: number;
  };

  // Copy behavior
  copy_behavior: {
    copy_exact_outcome: boolean;
    copy_exact_market: boolean;
    ignore_if_already_holding: boolean;
  };
}
```

---

## Mode 1: MIRROR_ALL

**Strategy**: Copy EVERY trade from ALL tracked wallets

**Use Case**: Maximum diversification across elite wallet activity

**Decision Logic**:
```typescript
if (wallet_is_tracked && trade_is_fresh) {
  return COPY;
}
```

**Pros**:
- Capture all alpha from elite wallets
- Maximum diversification
- No consensus needed

**Cons**:
- Could have 100+ positions
- Capital spread thin
- Higher transaction costs

**Example Config**:
```typescript
copy_trading: {
  enabled: true,
  mode: 'MIRROR_ALL',
  poll_interval_seconds: 60,
  max_latency_seconds: 120,
  mode_config: {},
  detection: {
    monitor_new_positions: true,
    monitor_position_increases: true,
    monitor_exits: false,
    grouping_window_seconds: 300,
  },
  copy_behavior: {
    copy_exact_outcome: true,
    copy_exact_market: true,
    ignore_if_already_holding: true,
  },
}
```

---

## Mode 2: CONSENSUS_ONLY

**Strategy**: Only copy when 2+ wallets agree on same position (OWRR ≥ threshold)

**Use Case**: High-conviction smart money signals

**Decision Logic**:
```typescript
if (owrr >= threshold && confidence >= min_confidence) {
  return COPY;
} else {
  return SKIP;
}
```

**Pros**:
- High conviction signals
- Lower false positives
- Capital concentrated in best opportunities

**Cons**:
- Miss solo trades from top performers
- Lower trade frequency

**Example Config**:
```typescript
copy_trading: {
  enabled: true,
  mode: 'CONSENSUS_ONLY',
  poll_interval_seconds: 60,
  max_latency_seconds: 120,
  mode_config: {
    owrr_thresholds: {
      min_yes: 0.65,  // 2+ wallets agree on YES
      min_no: 0.60,   // 2+ wallets agree on NO
      min_confidence: 'medium', // At least 3 qualified wallets traded
    },
  },
  detection: {
    monitor_new_positions: true,
    monitor_position_increases: true,
    monitor_exits: false,
    grouping_window_seconds: 300,
  },
  copy_behavior: {
    copy_exact_outcome: true,
    copy_exact_market: true,
    ignore_if_already_holding: true,
  },
}
```

---

## Mode 3: TOP_PERFORMER

**Strategy**: Only copy the #1 ranked wallet (highest Omega or other metric)

**Use Case**: Follow the absolute best performer

**Decision Logic**:
```typescript
if (wallet_address === top_wallet.address) {
  return COPY;
} else {
  return SKIP;
}
```

**Pros**:
- Follow the best of the best
- Simplest strategy
- Concentrated capital

**Cons**:
- No diversification
- Single point of failure
- Risk if top performer has bad streak

**Example Config**:
```typescript
copy_trading: {
  enabled: true,
  mode: 'TOP_PERFORMER',
  poll_interval_seconds: 60,
  max_latency_seconds: 120,
  mode_config: {
    weight_metric: 'omega', // Rank by Omega
  },
  detection: {
    monitor_new_positions: true,
    monitor_position_increases: true,
    monitor_exits: false,
    grouping_window_seconds: 300,
  },
  copy_behavior: {
    copy_exact_outcome: true,
    copy_exact_market: true,
    ignore_if_already_holding: true,
  },
}
```

---

## Mode 4: WEIGHTED

**Strategy**: Copy all trades but weight position size by wallet performance metric

**Use Case**: Balanced approach respecting wallet quality

**Decision Logic**:
```typescript
const weight = wallet.omega / sum_of_all_omegas;
const position_size = base_size * weight;

return COPY with position_size;
```

**Pros**:
- Respect performer quality
- Diversified but weighted
- Captures all activity

**Cons**:
- Complex position sizing
- Still spread across many positions
- Requires dynamic rebalancing

**Example Config**:
```typescript
copy_trading: {
  enabled: true,
  mode: 'WEIGHTED',
  poll_interval_seconds: 60,
  max_latency_seconds: 120,
  mode_config: {
    weight_metric: 'omega', // Weight by Omega
  },
  detection: {
    monitor_new_positions: true,
    monitor_position_increases: true,
    monitor_exits: false,
    grouping_window_seconds: 300,
  },
  copy_behavior: {
    copy_exact_outcome: true,
    copy_exact_market: true,
    ignore_if_already_holding: true,
  },
}
```

---

## Mode 5: TIER_BASED

**Strategy**: Different rules for different performance tiers

**Use Case**: Hierarchical trust - top wallets get more flexibility

**Decision Logic**:
```typescript
if (wallet_in_tier1) {
  return COPY; // Copy all trades
} else if (wallet_in_tier2 && consensus_met) {
  return COPY; // Need 2+ to agree
} else if (wallet_in_tier3 && strong_consensus) {
  return COPY; // Need 3+ to agree
}
```

**Pros**:
- Balanced approach
- Respect quality hierarchy
- Reduces noise from lower tiers

**Cons**:
- Complex multi-tier logic
- Need to define tier cutoffs

**Example Config**:
```typescript
copy_trading: {
  enabled: true,
  mode: 'TIER_BASED',
  poll_interval_seconds: 60,
  max_latency_seconds: 120,
  mode_config: {
    tiers: {
      tier1: { size: 10, rule: 'copy_all' },      // Top 10: Copy all
      tier2: { size: 20, rule: 'consensus' },     // 11-30: Need 2+ to agree
      tier3: { size: 20, rule: 'consensus' },     // 31-50: Need 3+ to agree
    },
  },
  detection: {
    monitor_new_positions: true,
    monitor_position_increases: true,
    monitor_exits: false,
    grouping_window_seconds: 300,
  },
  copy_behavior: {
    copy_exact_outcome: true,
    copy_exact_market: true,
    ignore_if_already_holding: true,
  },
}
```

---

## Mode 6: HYBRID

**Strategy**: Combine top performer mirroring + consensus for others

**Use Case**: Best of both worlds - mirror elite + follow consensus

**Decision Logic**:
```typescript
if (wallet_in_top_N) {
  return COPY; // Mirror top N wallets
} else if (owrr >= threshold) {
  return COPY; // Or copy when others agree
}
```

**Pros**:
- Captures solo alpha from top performers
- Also captures consensus from broader group
- Flexible and adaptive

**Cons**:
- Could have overlapping positions
- More complex to explain

**Example Config**:
```typescript
copy_trading: {
  enabled: true,
  mode: 'HYBRID',
  poll_interval_seconds: 60,
  max_latency_seconds: 120,
  mode_config: {
    hybrid_rules: {
      top_n_copy_all: 10,          // Copy all trades from top 10
      others_consensus_min: 2,     // Need 2+ wallets to agree for others
    },
    owrr_thresholds: {
      min_yes: 0.65,
      min_no: 0.60,
      min_confidence: 'medium',
    },
  },
  detection: {
    monitor_new_positions: true,
    monitor_position_increases: true,
    monitor_exits: false,
    grouping_window_seconds: 300,
  },
  copy_behavior: {
    copy_exact_outcome: true,
    copy_exact_market: true,
    ignore_if_already_holding: true,
  },
}
```

---

## Implementation Plan

### Phase 1: Update Schema ✅
- [x] Define `copy_trading.mode` field
- [x] Define `mode_config` structure

### Phase 2: Update Backend
- [ ] Update `DecisionEngine` to handle all 6 modes
- [ ] Update `WalletMonitor` to pass mode to DecisionEngine
- [ ] Add mode-specific decision logic

### Phase 3: Create Strategy Templates
- [ ] Create template: Mirror All Trades
- [ ] Create template: Consensus Only
- [ ] Create template: Top Performer Only
- [ ] Create template: Weighted Portfolio
- [ ] Create template: Tier-Based Copying
- [ ] Create template: Hybrid Mode

### Phase 4: Frontend (Future)
- [ ] Add mode selector to Orchestrator config panel
- [ ] Add mode-specific config UI
- [ ] Add visual indicators for different modes

---

## Position Sizing by Mode

| Mode | Position Sizing Strategy |
|------|-------------------------|
| **MIRROR_ALL** | Equal weight across all positions OR Kelly with equal probability |
| **CONSENSUS_ONLY** | Full Kelly based on OWRR confidence |
| **TOP_PERFORMER** | Full Kelly (single wallet, high confidence) |
| **WEIGHTED** | Kelly multiplied by wallet weight (omega/sum) |
| **TIER_BASED** | Tier1 = 1.0x Kelly, Tier2 = 0.75x Kelly, Tier3 = 0.5x Kelly |
| **HYBRID** | Top N = 1.0x Kelly, Consensus = 0.75x Kelly |

---

## Summary Table

| Mode | Trade Frequency | Diversification | Complexity | Best For |
|------|----------------|-----------------|------------|----------|
| **MIRROR_ALL** | Very High | Maximum | Low | Passive followers |
| **CONSENSUS_ONLY** | Low | Low | Medium | Conservative traders |
| **TOP_PERFORMER** | Medium | None | Low | Risk-takers |
| **WEIGHTED** | Very High | Balanced | High | Sophisticated traders |
| **TIER_BASED** | High | Balanced | High | Strategic allocators |
| **HYBRID** | High | Balanced | Medium | Flexible traders |
