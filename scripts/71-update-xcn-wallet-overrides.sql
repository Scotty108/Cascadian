-- XCN Wallet Identity Overrides Update
-- Based on progressive executor analysis (2025-11-17)
-- Decision: Base wallet only - all executors cause volume blowup

-- ============================================================================
-- STEP 1: Remove all existing XCN executor overrides
-- ============================================================================

DELETE FROM wallet_identity_overrides
WHERE canonical_wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

-- Expected: 12 rows deleted

-- ============================================================================
-- STEP 2: Blacklist the bloat executor globally
-- ============================================================================

CREATE TABLE IF NOT EXISTS wallet_identity_blacklist (
  executor_wallet String,
  reason String,
  blacklisted_at DateTime DEFAULT now(),
  blacklisted_by String DEFAULT 'C3-PnL-Agent'
) ENGINE = ReplacingMergeTree()
ORDER BY (executor_wallet, blacklisted_at);

INSERT INTO wallet_identity_blacklist (executor_wallet, reason, blacklisted_at)
VALUES (
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  'XCN bloat executor - contributed $2.58B volume (1,290x blowup in progressive analysis)',
  now()
);

-- ============================================================================
-- STEP 3: Document clustering decision
-- ============================================================================

CREATE TABLE IF NOT EXISTS wallet_clustering_decisions (
  canonical_wallet String,
  decision Enum8('base_only' = 0, 'clustered' = 1, 'pending_review' = 2),
  evidence String,
  decided_at DateTime DEFAULT now(),
  decided_by String DEFAULT 'C3-PnL-Agent'
) ENGINE = ReplacingMergeTree()
ORDER BY (canonical_wallet, decided_at);

INSERT INTO wallet_clustering_decisions (
  canonical_wallet,
  decision,
  evidence,
  decided_at
)
VALUES (
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  'base_only',
  'Progressive analysis 2025-11-17: All 12 executors cause 100x+ volume blowup. Target: $1.5M / +$80k. Base: $20k / -$20k. First executor jumps to $2.58B. No valid executor configuration found.',
  now()
);

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Verify overrides removed
SELECT
  count() AS remaining_overrides
FROM wallet_identity_overrides
WHERE canonical_wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
-- Expected: 0

-- Verify blacklist entry
SELECT *
FROM wallet_identity_blacklist
WHERE executor_wallet = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';
-- Expected: 1 row

-- Verify decision logged
SELECT *
FROM wallet_clustering_decisions
WHERE canonical_wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
ORDER BY decided_at DESC
LIMIT 1;
-- Expected: 1 row with decision = 'base_only'

-- ============================================================================
-- ROLLBACK SCRIPT (if needed)
-- ============================================================================

-- To restore original 12-executor cluster (NOT RECOMMENDED):
--
-- INSERT INTO wallet_identity_overrides (canonical_wallet, executor_wallet)
-- VALUES
--   ('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'),
--   ('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', '0x461f3e886dca22e561eee224d283e08b8fb47a07'),
--   ('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', '0x0540f430df85c770e0a4fb79d8499d71ebc298eb'),
--   ('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', '0x7fb7ad0d194d7123e711e7db6c9d418fac14e33d'),
--   ('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', '0x44c1dfe43260c94ed4f1d00de2e1f80fb113ebc1'),
--   ('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', '0x24c8cf69a0e0a17eee21f69d29752bfa32e823e1'),
--   ('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', '0xa6a856a8c8a7f14fd9be6ae11c367c7cbb755009'),
--   ('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', '0xb68a63d94676c8630eb3471d82d3d47b7533c568'),
--   ('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', '0x9d84ce0306f8551e02efef1680475fc0f1dc1344'),
--   ('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', '0x7c3db723f1d4d8cb9c550095203b686cb11e5c6b'),
--   ('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', '0xf29bb8e0712075041e87e8605b69833ef738dd4c'),
--   ('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', '0xee00ba338c59557141789b127927a55f5cc5cea1');
