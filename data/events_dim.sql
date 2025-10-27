-- events_dim: Event dimension table for category-level analysis
CREATE TABLE IF NOT EXISTS events_dim (
  event_id String,
  title Nullable(String),
  category Nullable(String),
  tags Array(String),
  status Nullable(String),
  ends_at Nullable(DateTime)
) ENGINE = MergeTree()
ORDER BY (event_id);
