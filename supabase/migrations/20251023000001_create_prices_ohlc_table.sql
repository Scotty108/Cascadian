-- Create table for 1-minute OHLC price data from Polymarket markets
CREATE TABLE IF NOT EXISTS public.prices_1m (
  id BIGSERIAL PRIMARY KEY,
  market_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  open NUMERIC(18, 8),
  high NUMERIC(18, 8),
  low NUMERIC(18, 8),
  close NUMERIC(18, 8),
  volume NUMERIC(18, 8),
  trade_count INTEGER,
  bid NUMERIC(18, 8),
  ask NUMERIC(18, 8),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Create composite index for efficient queries
  CONSTRAINT prices_1m_market_ts_unique UNIQUE (market_id, ts)
);

-- Create indexes for query performance
CREATE INDEX IF NOT EXISTS idx_prices_1m_market_id ON public.prices_1m(market_id);
CREATE INDEX IF NOT EXISTS idx_prices_1m_ts ON public.prices_1m(ts DESC);
CREATE INDEX IF NOT EXISTS idx_prices_1m_market_ts ON public.prices_1m(market_id, ts DESC);

-- Enable Row Level Security
ALTER TABLE public.prices_1m ENABLE ROW LEVEL SECURITY;

-- Create policy to allow read access to all users
CREATE POLICY "Allow public read access to prices"
  ON public.prices_1m
  FOR SELECT
  USING (true);

-- Add comment
COMMENT ON TABLE public.prices_1m IS 'OHLC price data for Polymarket markets at 1-minute intervals';
