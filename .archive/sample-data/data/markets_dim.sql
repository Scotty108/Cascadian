-- markets_dim: Market dimension table for P&L attribution
CREATE TABLE IF NOT EXISTS markets_dim (
  condition_id String,
  market_id String,
  event_id Nullable(String),
  question Nullable(String),
  resolved_outcome Nullable(String),
  payout_yes Nullable(Float64),
  payout_no Nullable(Float64),
  resolved_at Nullable(DateTime)
) ENGINE = MergeTree()
ORDER BY (condition_id);
