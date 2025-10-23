-- =====================================================================
-- POLYMARKET TEST DATA
-- =====================================================================
-- Purpose: Insert sample market data for testing schema, queries, and
--          application integration.
--
-- Contents:
--   - 20 diverse market examples
--   - Mix of categories (Politics, Sports, Crypto, Entertainment)
--   - Mix of active/closed status
--   - Mix of high/low volume
--   - Edge cases (very high volume, near end_date, etc.)
--
-- Usage:
--   psql $DATABASE_URL < polymarket-test-data.sql
--
-- Author: database-architect agent
-- Date: 2025-10-22
-- =====================================================================

-- Clear existing test data (optional)
-- TRUNCATE TABLE markets CASCADE;
-- TRUNCATE TABLE sync_logs CASCADE;

-- =====================================================================
-- SAMPLE MARKETS (20 rows)
-- =====================================================================

INSERT INTO markets (
  market_id,
  title,
  description,
  slug,
  condition_id,
  category,
  tags,
  image_url,
  outcomes,
  current_price,
  outcome_prices,
  volume_24h,
  volume_total,
  liquidity,
  active,
  closed,
  end_date,
  raw_polymarket_data
) VALUES

-- Market 1: High volume crypto market (active)
(
  '0x1a2b3c4d5e6f7890',
  'Will Bitcoin reach $100k by December 2025?',
  'This market resolves YES if Bitcoin (BTC) trades at or above $100,000 USD on any major exchange (Coinbase, Binance, Kraken) at any point before December 31, 2025 23:59:59 UTC.',
  'will-bitcoin-reach-100k-by-dec-2025',
  '0xabcdef1234567890',
  'Crypto',
  ARRAY['Bitcoin', 'Price Prediction', '2025'],
  'https://polymarket-upload.s3.amazonaws.com/bitcoin.png',
  ARRAY['Yes', 'No'],
  0.65000000,
  ARRAY[0.65000000, 0.35000000],
  250000.00,
  5000000.00,
  125000.00,
  true,
  false,
  '2025-12-31 23:59:59+00',
  '{"id": "0x1a2b3c4d5e6f7890", "question": "Will Bitcoin reach $100k by December 2025?", "created_at": "2024-01-15T10:00:00Z"}'::jsonb
),

-- Market 2: Politics market (active, high volume)
(
  '0x2b3c4d5e6f7890a1',
  'Will Donald Trump win the 2024 US Presidential Election?',
  'Resolves YES if Donald Trump wins the 2024 US Presidential Election and is inaugurated as the 47th President.',
  'will-trump-win-2024-election',
  '0xbcdef12345678901',
  'Politics',
  ARRAY['US Politics', 'Presidential Election', '2024'],
  'https://polymarket-upload.s3.amazonaws.com/trump.png',
  ARRAY['Yes', 'No'],
  0.52000000,
  ARRAY[0.52000000, 0.48000000],
  500000.00,
  12000000.00,
  300000.00,
  true,
  false,
  '2024-11-05 23:59:59+00',
  '{"id": "0x2b3c4d5e6f7890a1", "question": "Will Donald Trump win the 2024 US Presidential Election?"}'::jsonb
),

-- Market 3: Sports market (active, medium volume)
(
  '0x3c4d5e6f7890a1b2',
  'Will the Lakers win the 2025 NBA Championship?',
  'Resolves YES if the Los Angeles Lakers win the 2025 NBA Finals.',
  'will-lakers-win-2025-nba-championship',
  '0xcdef123456789012',
  'Sports',
  ARRAY['NBA', 'Lakers', 'Basketball', '2025'],
  'https://polymarket-upload.s3.amazonaws.com/lakers.png',
  ARRAY['Yes', 'No'],
  0.28000000,
  ARRAY[0.28000000, 0.72000000],
  85000.00,
  450000.00,
  40000.00,
  true,
  false,
  '2025-06-30 23:59:59+00',
  '{"id": "0x3c4d5e6f7890a1b2", "question": "Will the Lakers win the 2025 NBA Championship?"}'::jsonb
),

-- Market 4: Entertainment (active, low volume)
(
  '0x4d5e6f7890a1b2c3',
  'Will Taylor Swift release a new album in 2025?',
  'Resolves YES if Taylor Swift releases a new studio album in 2025.',
  'will-taylor-swift-release-album-2025',
  '0xdef1234567890123',
  'Entertainment',
  ARRAY['Taylor Swift', 'Music', 'Album', '2025'],
  'https://polymarket-upload.s3.amazonaws.com/taylor-swift.png',
  ARRAY['Yes', 'No'],
  0.72000000,
  ARRAY[0.72000000, 0.28000000],
  15000.00,
  80000.00,
  8000.00,
  true,
  false,
  '2025-12-31 23:59:59+00',
  '{"id": "0x4d5e6f7890a1b2c3", "question": "Will Taylor Swift release a new album in 2025?"}'::jsonb
),

-- Market 5: Crypto (active, very high volume)
(
  '0x5e6f7890a1b2c3d4',
  'Will Ethereum surpass $5000 in 2025?',
  'Resolves YES if Ethereum (ETH) trades at or above $5,000 USD on any major exchange in 2025.',
  'will-ethereum-surpass-5000-in-2025',
  '0xef12345678901234',
  'Crypto',
  ARRAY['Ethereum', 'Price Prediction', '2025'],
  'https://polymarket-upload.s3.amazonaws.com/ethereum.png',
  ARRAY['Yes', 'No'],
  0.58000000,
  ARRAY[0.58000000, 0.42000000],
  450000.00,
  8000000.00,
  200000.00,
  true,
  false,
  '2025-12-31 23:59:59+00',
  '{"id": "0x5e6f7890a1b2c3d4", "question": "Will Ethereum surpass $5000 in 2025?"}'::jsonb
),

-- Market 6: Politics (active, closing soon)
(
  '0x6f7890a1b2c3d4e5',
  'Will there be a government shutdown in Q4 2024?',
  'Resolves YES if the US federal government shuts down for at least 24 hours in Q4 2024.',
  'will-us-government-shutdown-q4-2024',
  '0xf123456789012345',
  'Politics',
  ARRAY['US Politics', 'Government Shutdown', '2024'],
  'https://polymarket-upload.s3.amazonaws.com/shutdown.png',
  ARRAY['Yes', 'No'],
  0.35000000,
  ARRAY[0.35000000, 0.65000000],
  95000.00,
  320000.00,
  45000.00,
  true,
  false,
  '2024-12-31 23:59:59+00',
  '{"id": "0x6f7890a1b2c3d4e5", "question": "Will there be a government shutdown in Q4 2024?"}'::jsonb
),

-- Market 7: Sports (active, edge case: very low price)
(
  '0x7890a1b2c3d4e5f6',
  'Will the Detroit Lions win the Super Bowl in 2025?',
  'Resolves YES if the Detroit Lions win Super Bowl LIX in February 2025.',
  'will-lions-win-super-bowl-2025',
  '0x1234567890123456',
  'Sports',
  ARRAY['NFL', 'Lions', 'Super Bowl', '2025'],
  'https://polymarket-upload.s3.amazonaws.com/lions.png',
  ARRAY['Yes', 'No'],
  0.08000000,
  ARRAY[0.08000000, 0.92000000],
  28000.00,
  150000.00,
  12000.00,
  true,
  false,
  '2025-02-09 23:59:59+00',
  '{"id": "0x7890a1b2c3d4e5f6", "question": "Will the Detroit Lions win the Super Bowl in 2025?"}'::jsonb
),

-- Market 8: Crypto (active, edge case: very high price)
(
  '0x890a1b2c3d4e5f67',
  'Will Bitcoin drop below $30k in 2025?',
  'Resolves YES if Bitcoin (BTC) trades below $30,000 USD on any major exchange in 2025.',
  'will-bitcoin-drop-below-30k-in-2025',
  '0x2345678901234567',
  'Crypto',
  ARRAY['Bitcoin', 'Price Prediction', 'Bearish'],
  'https://polymarket-upload.s3.amazonaws.com/bitcoin-bear.png',
  ARRAY['Yes', 'No'],
  0.12000000,
  ARRAY[0.12000000, 0.88000000],
  65000.00,
  500000.00,
  35000.00,
  true,
  false,
  '2025-12-31 23:59:59+00',
  '{"id": "0x890a1b2c3d4e5f67", "question": "Will Bitcoin drop below $30k in 2025?"}'::jsonb
),

-- Market 9: Entertainment (active, medium volume)
(
  '0x90a1b2c3d4e5f678',
  'Will "Dune: Part Three" be announced in 2025?',
  'Resolves YES if Warner Bros. officially announces "Dune: Part Three" in 2025.',
  'will-dune-part-three-be-announced-2025',
  '0x3456789012345678',
  'Entertainment',
  ARRAY['Movies', 'Dune', 'Announcement'],
  'https://polymarket-upload.s3.amazonaws.com/dune.png',
  ARRAY['Yes', 'No'],
  0.68000000,
  ARRAY[0.68000000, 0.32000000],
  42000.00,
  180000.00,
  22000.00,
  true,
  false,
  '2025-12-31 23:59:59+00',
  '{"id": "0x90a1b2c3d4e5f678", "question": "Will Dune Part Three be announced in 2025?"}'::jsonb
),

-- Market 10: Politics (closed, resolved YES)
(
  '0xa1b2c3d4e5f67890',
  'Will Joe Biden run for re-election in 2024?',
  'Resolves YES if Joe Biden officially announces his candidacy for re-election.',
  'will-biden-run-for-reelection-2024',
  '0x4567890123456789',
  'Politics',
  ARRAY['US Politics', 'Biden', '2024'],
  'https://polymarket-upload.s3.amazonaws.com/biden.png',
  ARRAY['Yes', 'No'],
  1.00000000, -- Resolved YES
  ARRAY[1.00000000, 0.00000000],
  120000.00,
  800000.00,
  0.00, -- No liquidity (closed)
  false, -- Not active
  true,  -- Closed
  '2024-04-30 23:59:59+00',
  '{"id": "0xa1b2c3d4e5f67890", "question": "Will Joe Biden run for re-election in 2024?", "resolved": true, "outcome": "Yes"}'::jsonb
),

-- Market 11: Crypto (closed, resolved NO)
(
  '0xb2c3d4e5f6789012',
  'Will Bitcoin reach $200k by end of 2023?',
  'Resolves YES if Bitcoin (BTC) trades at or above $200,000 USD by December 31, 2023.',
  'will-bitcoin-reach-200k-by-2023',
  '0x5678901234567890',
  'Crypto',
  ARRAY['Bitcoin', 'Price Prediction', '2023'],
  'https://polymarket-upload.s3.amazonaws.com/bitcoin-moon.png',
  ARRAY['Yes', 'No'],
  0.00000000, -- Resolved NO
  ARRAY[0.00000000, 1.00000000],
  85000.00,
  650000.00,
  0.00,
  false,
  true,
  '2023-12-31 23:59:59+00',
  '{"id": "0xb2c3d4e5f6789012", "question": "Will Bitcoin reach $200k by end of 2023?", "resolved": true, "outcome": "No"}'::jsonb
),

-- Market 12: Sports (active, low liquidity)
(
  '0xc3d4e5f678901234',
  'Will Max Verstappen win the 2025 F1 Championship?',
  'Resolves YES if Max Verstappen wins the 2025 Formula 1 World Championship.',
  'will-verstappen-win-2025-f1-championship',
  '0x6789012345678901',
  'Sports',
  ARRAY['F1', 'Verstappen', 'Racing'],
  'https://polymarket-upload.s3.amazonaws.com/f1.png',
  ARRAY['Yes', 'No'],
  0.82000000,
  ARRAY[0.82000000, 0.18000000],
  18000.00,
  90000.00,
  8000.00,
  true,
  false,
  '2025-11-30 23:59:59+00',
  '{"id": "0xc3d4e5f678901234", "question": "Will Max Verstappen win the 2025 F1 Championship?"}'::jsonb
),

-- Market 13: Entertainment (active, high certainty)
(
  '0xd4e5f67890123456',
  'Will "Avatar 3" be released in 2025?',
  'Resolves YES if "Avatar: The Seed Bearer" is released in theaters in 2025.',
  'will-avatar-3-release-2025',
  '0x7890123456789012',
  'Entertainment',
  ARRAY['Movies', 'Avatar', 'Release Date'],
  'https://polymarket-upload.s3.amazonaws.com/avatar.png',
  ARRAY['Yes', 'No'],
  0.92000000,
  ARRAY[0.92000000, 0.08000000],
  32000.00,
  200000.00,
  15000.00,
  true,
  false,
  '2025-12-31 23:59:59+00',
  '{"id": "0xd4e5f67890123456", "question": "Will Avatar 3 be released in 2025?"}'::jsonb
),

-- Market 14: Crypto (active, medium price)
(
  '0xe5f6789012345678',
  'Will Solana flip Ethereum by market cap in 2025?',
  'Resolves YES if Solana surpasses Ethereum in market capitalization at any point in 2025.',
  'will-solana-flip-ethereum-2025',
  '0x8901234567890123',
  'Crypto',
  ARRAY['Solana', 'Ethereum', 'Market Cap', 'Flippening'],
  'https://polymarket-upload.s3.amazonaws.com/solana.png',
  ARRAY['Yes', 'No'],
  0.18000000,
  ARRAY[0.18000000, 0.82000000],
  95000.00,
  720000.00,
  55000.00,
  true,
  false,
  '2025-12-31 23:59:59+00',
  '{"id": "0xe5f6789012345678", "question": "Will Solana flip Ethereum by market cap in 2025?"}'::jsonb
),

-- Market 15: Politics (active, tight race)
(
  '0xf67890123456789a',
  'Will Kamala Harris be the Democratic nominee in 2028?',
  'Resolves YES if Kamala Harris is the Democratic Party nominee for President in 2028.',
  'will-kamala-harris-be-dem-nominee-2028',
  '0x901234567890123a',
  'Politics',
  ARRAY['US Politics', 'Democrats', '2028'],
  'https://polymarket-upload.s3.amazonaws.com/harris.png',
  ARRAY['Yes', 'No'],
  0.48000000,
  ARRAY[0.48000000, 0.52000000],
  75000.00,
  400000.00,
  38000.00,
  true,
  false,
  '2028-08-31 23:59:59+00',
  '{"id": "0xf67890123456789a", "question": "Will Kamala Harris be the Democratic nominee in 2028?"}'::jsonb
),

-- Market 16: Sports (active, niche sport)
(
  '0x0123456789abcdef',
  'Will Team USA win gold in basketball at 2024 Olympics?',
  'Resolves YES if Team USA wins the gold medal in men''s basketball at the 2024 Paris Olympics.',
  'will-team-usa-win-basketball-2024-olympics',
  '0xa1234567890123ab',
  'Sports',
  ARRAY['Olympics', 'Basketball', 'Team USA', '2024'],
  'https://polymarket-upload.s3.amazonaws.com/olympics.png',
  ARRAY['Yes', 'No'],
  0.76000000,
  ARRAY[0.76000000, 0.24000000],
  52000.00,
  280000.00,
  28000.00,
  true,
  false,
  '2024-08-11 23:59:59+00',
  '{"id": "0x0123456789abcdef", "question": "Will Team USA win gold in basketball at 2024 Olympics?"}'::jsonb
),

-- Market 17: Crypto (active, edge case: exactly 50/50)
(
  '0x123456789abcdef0',
  'Will Cardano reach $5 before Ethereum reaches $10k?',
  'Resolves YES if Cardano (ADA) reaches $5 before Ethereum (ETH) reaches $10,000.',
  'will-cardano-5-before-ethereum-10k',
  '0xb234567890123abc',
  'Crypto',
  ARRAY['Cardano', 'Ethereum', 'Race'],
  'https://polymarket-upload.s3.amazonaws.com/cardano-eth-race.png',
  ARRAY['Yes', 'No'],
  0.50000000,
  ARRAY[0.50000000, 0.50000000],
  68000.00,
  450000.00,
  42000.00,
  true,
  false,
  '2026-12-31 23:59:59+00',
  '{"id": "0x123456789abcdef0", "question": "Will Cardano reach $5 before Ethereum reaches $10k?"}'::jsonb
),

-- Market 18: Entertainment (active, controversial)
(
  '0x23456789abcdef01',
  'Will Elon Musk buy CNN in 2025?',
  'Resolves YES if Elon Musk or a company he controls acquires CNN in 2025.',
  'will-elon-musk-buy-cnn-2025',
  '0xc34567890123abcd',
  'Entertainment',
  ARRAY['Elon Musk', 'CNN', 'Acquisition', 'Media'],
  'https://polymarket-upload.s3.amazonaws.com/elon-cnn.png',
  ARRAY['Yes', 'No'],
  0.15000000,
  ARRAY[0.15000000, 0.85000000],
  88000.00,
  520000.00,
  48000.00,
  true,
  false,
  '2025-12-31 23:59:59+00',
  '{"id": "0x23456789abcdef01", "question": "Will Elon Musk buy CNN in 2025?"}'::jsonb
),

-- Market 19: Politics (active, long-term)
(
  '0x3456789abcdef012',
  'Will the US implement universal basic income by 2030?',
  'Resolves YES if the US federal government implements a universal basic income program by 2030.',
  'will-us-implement-ubi-by-2030',
  '0xd4567890123abcde',
  'Politics',
  ARRAY['UBI', 'Universal Basic Income', 'Policy'],
  'https://polymarket-upload.s3.amazonaws.com/ubi.png',
  ARRAY['Yes', 'No'],
  0.22000000,
  ARRAY[0.22000000, 0.78000000],
  38000.00,
  220000.00,
  18000.00,
  true,
  false,
  '2030-12-31 23:59:59+00',
  '{"id": "0x3456789abcdef012", "question": "Will the US implement universal basic income by 2030?"}'::jsonb
),

-- Market 20: Sports (active, edge case: very near end date)
(
  '0x456789abcdef0123',
  'Will a new NBA scoring record be set in the 2024-25 season?',
  'Resolves YES if any player breaks the single-game scoring record (73 points) in the 2024-25 NBA season.',
  'will-new-nba-scoring-record-2024-25',
  '0xe567890123abcdef',
  'Sports',
  ARRAY['NBA', 'Scoring Record', 'Basketball'],
  'https://polymarket-upload.s3.amazonaws.com/nba-record.png',
  ARRAY['Yes', 'No'],
  0.12000000,
  ARRAY[0.12000000, 0.88000000],
  25000.00,
  120000.00,
  12000.00,
  true,
  false,
  '2025-04-30 23:59:59+00',
  '{"id": "0x456789abcdef0123", "question": "Will a new NBA scoring record be set in the 2024-25 season?"}'::jsonb
);

-- =====================================================================
-- SAMPLE SYNC LOGS (5 entries)
-- =====================================================================

INSERT INTO sync_logs (
  sync_started_at,
  sync_completed_at,
  duration_ms,
  status,
  markets_fetched,
  markets_synced,
  markets_failed,
  error_message,
  api_response_time_ms,
  api_rate_limited,
  triggered_by,
  sync_config
) VALUES

-- Successful sync
(
  '2025-10-22 13:00:00+00',
  '2025-10-22 13:00:12+00',
  12450,
  'success',
  1234,
  1234,
  0,
  null,
  380,
  false,
  'cron',
  '{"batch_size": 500, "include_closed": false}'::jsonb
),

-- Successful sync (older)
(
  '2025-10-22 12:45:00+00',
  '2025-10-22 12:45:15+00',
  15230,
  'success',
  1228,
  1228,
  0,
  null,
  420,
  false,
  'cron',
  '{"batch_size": 500, "include_closed": false}'::jsonb
),

-- Partial sync (some failures)
(
  '2025-10-22 12:30:00+00',
  '2025-10-22 12:30:18+00',
  18650,
  'partial',
  1240,
  1235,
  5,
  'Failed to parse 5 markets due to missing required fields',
  450,
  false,
  'cron',
  '{"batch_size": 500, "include_closed": false}'::jsonb
),

-- Failed sync (rate limited)
(
  '2025-10-22 12:15:00+00',
  '2025-10-22 12:15:05+00',
  5120,
  'failed',
  0,
  0,
  0,
  'Polymarket API rate limit exceeded (429)',
  null,
  true,
  'cron',
  '{"batch_size": 500, "include_closed": false}'::jsonb
),

-- Manual sync (successful)
(
  '2025-10-22 11:30:00+00',
  '2025-10-22 11:30:10+00',
  10890,
  'success',
  1220,
  1220,
  0,
  null,
  360,
  false,
  'manual',
  '{"batch_size": 250, "include_closed": true}'::jsonb
);

-- =====================================================================
-- VERIFICATION
-- =====================================================================

DO $$
DECLARE
  market_count INTEGER;
  sync_log_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO market_count FROM markets;
  SELECT COUNT(*) INTO sync_log_count FROM sync_logs;

  RAISE NOTICE 'Test data inserted successfully!';
  RAISE NOTICE '  - Markets: %', market_count;
  RAISE NOTICE '  - Sync logs: %', sync_log_count;

  -- Verify constraints are working
  IF market_count < 20 THEN
    RAISE WARNING 'Expected 20 markets, got %', market_count;
  END IF;

  IF sync_log_count < 5 THEN
    RAISE WARNING 'Expected 5 sync logs, got %', sync_log_count;
  END IF;
END $$;

-- =====================================================================
-- SAMPLE QUERIES (for testing)
-- =====================================================================

-- Query 1: Get active markets sorted by volume
SELECT
  market_id,
  title,
  category,
  volume_24h,
  current_price
FROM markets
WHERE active = TRUE
ORDER BY volume_24h DESC
LIMIT 10;

-- Query 2: Search for Bitcoin markets
SELECT
  market_id,
  title,
  current_price,
  volume_24h
FROM markets
WHERE active = TRUE
  AND title ILIKE '%bitcoin%'
ORDER BY volume_24h DESC;

-- Query 3: Get markets by category
SELECT
  market_id,
  title,
  current_price,
  volume_24h,
  end_date
FROM markets
WHERE active = TRUE
  AND category = 'Crypto'
ORDER BY volume_24h DESC;

-- Query 4: Get recent sync logs
SELECT
  id,
  sync_started_at,
  status,
  duration_ms,
  markets_synced,
  api_rate_limited
FROM sync_logs
ORDER BY sync_started_at DESC
LIMIT 5;

-- Query 5: Check data staleness
SELECT
  get_market_data_staleness() AS staleness,
  is_market_data_stale(5) AS needs_sync;
