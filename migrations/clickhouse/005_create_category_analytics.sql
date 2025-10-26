-- Migration 005: Create category_analytics table
-- Purpose: Aggregate metrics at category level (Austin Methodology foundation)
-- Priority: CRITICAL (Phase 1)

CREATE TABLE IF NOT EXISTS category_analytics (
  category String,
  window Enum8('24h' = 1, '7d' = 2, '30d' = 3, 'lifetime' = 4),

  -- WINNABILITY METRICS (Austin Methodology Core)
  elite_wallet_count UInt32 COMMENT 'Count wallets with Omega>2.0, n>50',
  median_omega_of_elites Decimal(12, 4) COMMENT 'HOW WINNABLE IS THIS GAME?',
  mean_clv_of_elites Decimal(10, 6) COMMENT 'Sucker Index - dumb money available',
  percentile_75_omega Decimal(12, 4) COMMENT '75th percentile Omega in category',
  percentile_25_omega Decimal(12, 4) COMMENT '25th percentile Omega',

  -- Market Stats
  total_markets UInt32,
  active_markets_24h UInt32,
  resolved_markets_7d UInt32,
  avg_time_to_resolution_days Decimal(10, 2),

  -- Volume Stats
  total_volume_usd Decimal(18, 2),
  elite_volume_usd Decimal(18, 2) COMMENT 'Volume from elite wallets only',
  crowd_volume_usd Decimal(18, 2) COMMENT 'Volume from non-elite wallets',
  volume_24h Decimal(18, 2),

  -- Competition Metrics
  avg_wallets_per_market Decimal(10, 2),
  specialist_concentration Decimal(5, 4) COMMENT 'HHI of elite wallet market share',
  barrier_to_entry_score Decimal(10, 6) COMMENT 'Composite: specialist_count + median_omega',

  -- Edge Durability
  avg_edge_half_life_hours Decimal(12, 2) COMMENT 'How long edges last in this category',
  avg_latency_penalty_index Decimal(10, 6) COMMENT 'How copy-able is this category',

  -- Behavioral Patterns
  avg_holding_period_hours Decimal(12, 2),
  news_driven_pct Decimal(5, 4) COMMENT '% of volume within 1hr of news',

  calculated_at DateTime,

  PRIMARY KEY (category, window)
)
ENGINE = ReplacingMergeTree(calculated_at)
ORDER BY (category, window);

-- Index for winnability queries
CREATE INDEX IF NOT EXISTS idx_winnability ON category_analytics(median_omega_of_elites)
  TYPE minmax GRANULARITY 4;

COMMENT ON TABLE category_analytics IS 'Category-level metrics for Austin Methodology - identify winnable games';
