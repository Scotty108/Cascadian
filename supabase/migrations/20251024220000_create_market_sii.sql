-- Market SII (Smart Investor Index) Table
-- Tracks which side of each market has smarter money (higher Omega scores)
-- Updates continuously as new positions are added

CREATE TABLE IF NOT EXISTS market_sii (
  id BIGSERIAL PRIMARY KEY,
  market_id TEXT NOT NULL UNIQUE,

  -- YES side metrics
  yes_top_wallets TEXT[], -- Array of top 20 wallet addresses
  yes_avg_omega DECIMAL(10, 4),
  yes_total_volume DECIMAL(18, 2),
  yes_wallet_count INTEGER DEFAULT 0,

  -- NO side metrics
  no_top_wallets TEXT[], -- Array of top 20 wallet addresses
  no_avg_omega DECIMAL(10, 4),
  no_total_volume DECIMAL(18, 2),
  no_wallet_count INTEGER DEFAULT 0,

  -- Signal
  smart_money_side TEXT CHECK (smart_money_side IN ('YES', 'NO', 'NEUTRAL')),
  omega_differential DECIMAL(10, 4), -- YES avg Omega - NO avg Omega
  signal_strength DECIMAL(5, 4), -- 0.0 to 1.0 (how strong the signal is)
  confidence_score DECIMAL(5, 4), -- Based on sample size and Omega quality

  -- Market context (for quick display)
  market_question TEXT,
  current_yes_price DECIMAL(5, 4),
  current_no_price DECIMAL(5, 4),

  -- Timestamps
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Indexes
  CONSTRAINT market_sii_market_id_key UNIQUE (market_id)
);

-- Index for market lookups
CREATE INDEX idx_market_sii_market ON market_sii(market_id);

-- Index for signal queries (show me markets where smart money is on YES)
CREATE INDEX idx_market_sii_signal ON market_sii(smart_money_side, signal_strength DESC)
  WHERE signal_strength > 0.5;

-- Index for strongest signals
CREATE INDEX idx_market_sii_strongest ON market_sii(signal_strength DESC, omega_differential DESC);

-- Index for recent updates (show me freshest signals)
CREATE INDEX idx_market_sii_recent ON market_sii(calculated_at DESC);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_market_sii_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_market_sii_updated_at_trigger
  BEFORE UPDATE ON market_sii
  FOR EACH ROW
  EXECUTE FUNCTION update_market_sii_updated_at();

-- Comments
COMMENT ON TABLE market_sii IS 'Smart Investor Index - tracks which side of each market has higher Omega scores';
COMMENT ON COLUMN market_sii.smart_money_side IS 'Which side has higher average Omega ratio (smarter money)';
COMMENT ON COLUMN market_sii.omega_differential IS 'Difference in average Omega (YES - NO). Positive = YES has edge, Negative = NO has edge';
COMMENT ON COLUMN market_sii.signal_strength IS 'How strong the signal is (0-1). Higher = more conviction';
COMMENT ON COLUMN market_sii.confidence_score IS 'Confidence based on sample size and Omega quality (0-1)';
