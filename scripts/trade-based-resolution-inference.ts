/**
 * TRADE-BASED RESOLUTION INFERENCE
 * Uses final trade prices per outcome to infer resolutions
 * Theory: If outcome 0 trades at ~$1 and outcome 1 at ~$0, then outcome 0 won
 */

import { createClient } from '@clickhouse/client';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function main() {
  console.log('=== TRADE-BASED RESOLUTION INFERENCE ===\n');
  console.log('Approach: Use final trade prices per outcome token to infer winners\n');

  // Step 1: Validate on known resolutions
  console.log('=== PHASE 1: VALIDATION ===\n');
  console.log('Finding markets with known resolutions + trade data...');

  const validation = await client.query({
    query: `
      WITH
      -- Get markets with known resolutions
      known_resolutions AS (
        SELECT
          condition_id_norm as cid_norm,
          winning_index
        FROM market_resolutions_final
        WHERE winning_index >= 0
        LIMIT 100  -- Test on 100 samples
      ),
      -- Calculate time cutoff for each market
      time_cutoffs AS (
        SELECT
          lower(replaceAll(cid, '0x', '')) as cid_norm,
          max(block_time) - INTERVAL 7 DAY as cutoff_time
        FROM fact_trades_clean ft
        INNER JOIN known_resolutions kr
          ON lower(replaceAll(ft.cid, '0x', '')) = kr.cid_norm
        GROUP BY cid_norm
      ),
      -- Get final 7 days of trades for these markets
      final_trades AS (
        SELECT
          lower(replaceAll(ft.cid, '0x', '')) as cid_norm,
          ft.outcome_index,
          avg(toFloat64(ft.price)) as avg_price,
          count() as trade_count,
          max(ft.block_time) as last_trade
        FROM fact_trades_clean ft
        INNER JOIN time_cutoffs tc
          ON lower(replaceAll(ft.cid, '0x', '')) = tc.cid_norm
        WHERE ft.block_time >= tc.cutoff_time
        GROUP BY cid_norm, ft.outcome_index
      ),
      -- Pivot to get both outcomes side-by-side
      outcome_prices AS (
        SELECT
          cid_norm,
          maxIf(avg_price, outcome_index = 0) as outcome_0_price,
          maxIf(avg_price, outcome_index = 1) as outcome_1_price,
          maxIf(trade_count, outcome_index = 0) as outcome_0_trades,
          maxIf(trade_count, outcome_index = 1) as outcome_1_trades
        FROM final_trades
        GROUP BY cid_norm
        HAVING outcome_0_price > 0 AND outcome_1_price > 0
      )
      SELECT
        '0x' || op.cid_norm as condition_id,
        kr.winning_index as actual_winner,
        op.outcome_0_price,
        op.outcome_1_price,
        op.outcome_0_trades,
        op.outcome_1_trades,
        -- Infer winner based on prices
        CASE
          WHEN op.outcome_0_price > 0.90 AND op.outcome_1_price < 0.10 THEN 0
          WHEN op.outcome_1_price > 0.90 AND op.outcome_0_price < 0.10 THEN 1
          ELSE -1
        END as inferred_winner,
        -- Calculate confidence
        CASE
          WHEN op.outcome_0_price > 0.90 AND op.outcome_1_price < 0.10
            THEN greatest(op.outcome_0_price, 1.0 - op.outcome_1_price)
          WHEN op.outcome_1_price > 0.90 AND op.outcome_0_price < 0.10
            THEN greatest(op.outcome_1_price, 1.0 - op.outcome_0_price)
          ELSE 0.0
        END as confidence
      FROM outcome_prices op
      INNER JOIN known_resolutions kr ON op.cid_norm = kr.cid_norm
    `,
    format: 'JSONEachRow',
  });

  const validationData = await validation.json();
  console.log(`✓ Found ${validationData.length} markets to validate\n`);

  if (validationData.length === 0) {
    console.log('❌ No markets found for validation. Check:');
    console.log('1. fact_trades_clean has data');
    console.log('2. Condition IDs are properly normalized');
    console.log('3. Recent trades exist (last 7 days)\n');
    return;
  }

  // Calculate accuracy
  const results = validationData.map((m: any) => ({
    condition_id: m.condition_id.slice(0, 12) + '...',
    actual: m.actual_winner,
    inferred: m.inferred_winner,
    outcome_0: Number(m.outcome_0_price).toFixed(3),
    outcome_1: Number(m.outcome_1_price).toFixed(3),
    trades_0: m.outcome_0_trades,
    trades_1: m.outcome_1_trades,
    confidence: Number(m.confidence).toFixed(3),
    correct: m.inferred_winner === m.actual_winner ? '✓' : '✗',
  }));

  console.log('Sample Validation Results:');
  console.table(results.slice(0, 15));

  const correct = validationData.filter((m: any) => m.inferred_winner === m.actual_winner).length;
  const withInference = validationData.filter((m: any) => m.inferred_winner >= 0).length;
  const accuracy = withInference > 0 ? (correct / withInference * 100) : 0;

  console.log(`\n📊 VALIDATION RESULTS:`);
  console.log(`   Markets analyzed: ${validationData.length}`);
  console.log(`   Clear inferences: ${withInference}`);
  console.log(`   Correct predictions: ${correct}/${withInference}`);
  console.log(`   Accuracy: ${accuracy.toFixed(1)}%`);
  console.log(`   Theory ${accuracy >= 90 ? '✓ VALIDATED' : '✗ NEEDS REFINEMENT'}\n`);

  if (accuracy < 80) {
    console.log('⚠️  Accuracy too low for production use');
    console.log('   Consider:');
    console.log('   - Adjusting time window (7 days → 24 hours?)');
    console.log('   - Stricter thresholds (0.90 → 0.95)');
    console.log('   - Minimum trade count requirements\n');
    return;
  }

  // Step 2: Coverage analysis
  console.log('\n=== PHASE 2: COVERAGE POTENTIAL ===\n');

  const coverage = await client.query({
    query: `
      WITH
      -- Markets without resolutions
      unresolved AS (
        SELECT DISTINCT
          lower(replaceAll(cid, '0x', '')) as cid_norm
        FROM fact_trades_clean
        WHERE lower(replaceAll(cid, '0x', '')) NOT IN (
          SELECT condition_id_norm
          FROM market_resolutions_final
        )
      ),
      -- Final trades for unresolved markets
      final_trades AS (
        SELECT
          lower(replaceAll(ft.cid, '0x', '')) as cid_norm,
          ft.outcome_index,
          avg(toFloat64(ft.price)) as avg_price,
          count() as trade_count
        FROM fact_trades_clean ft
        INNER JOIN unresolved u ON lower(replaceAll(ft.cid, '0x', '')) = u.cid_norm
        WHERE ft.block_time >= (
          SELECT max(block_time) - INTERVAL 7 DAY
          FROM fact_trades_clean ft2
          WHERE lower(replaceAll(ft2.cid, '0x', '')) = lower(replaceAll(ft.cid, '0x', ''))
        )
        GROUP BY cid_norm, ft.outcome_index
      ),
      -- Check for clear signals
      clear_signals AS (
        SELECT
          cid_norm,
          maxIf(avg_price, outcome_index = 0) as p0,
          maxIf(avg_price, outcome_index = 1) as p1
        FROM final_trades
        GROUP BY cid_norm
        HAVING (p0 > 0.90 AND p1 < 0.10) OR (p1 > 0.90 AND p0 < 0.10)
      )
      SELECT
        (SELECT count(DISTINCT cid_norm) FROM unresolved) as unresolved_markets,
        (SELECT count(DISTINCT cid_norm) FROM final_trades) as with_recent_trades,
        count() as recoverable_via_trades,
        round(count() * 100.0 / (SELECT count(DISTINCT cid_norm) FROM unresolved), 2) as recovery_pct
      FROM clear_signals
    `,
    format: 'JSONEachRow',
  });

  const coverageData = await coverage.json();
  console.log('Coverage Analysis:');
  console.table(coverageData);

  // Step 3: Generate recovery candidates
  console.log('\n=== PHASE 3: RECOVERY CANDIDATES ===\n');

  const candidates = await client.query({
    query: `
      WITH
      unresolved AS (
        SELECT DISTINCT
          lower(replaceAll(cid, '0x', '')) as cid_norm
        FROM fact_trades_clean
        WHERE lower(replaceAll(cid, '0x', '')) NOT IN (
          SELECT condition_id_norm
          FROM market_resolutions_final
        )
      ),
      final_trades AS (
        SELECT
          lower(replaceAll(ft.cid, '0x', '')) as cid_norm,
          ft.outcome_index,
          avg(toFloat64(ft.price)) as avg_price,
          count() as trade_count,
          max(ft.block_time) as last_trade
        FROM fact_trades_clean ft
        INNER JOIN unresolved u ON lower(replaceAll(ft.cid, '0x', '')) = u.cid_norm
        WHERE ft.block_time >= (
          SELECT max(block_time) - INTERVAL 7 DAY
          FROM fact_trades_clean ft2
          WHERE lower(replaceAll(ft2.cid, '0x', '')) = lower(replaceAll(ft.cid, '0x', ''))
        )
        GROUP BY cid_norm, ft.outcome_index
      ),
      outcome_prices AS (
        SELECT
          cid_norm,
          maxIf(avg_price, outcome_index = 0) as p0,
          maxIf(avg_price, outcome_index = 1) as p1,
          maxIf(trade_count, outcome_index = 0) as tc0,
          maxIf(trade_count, outcome_index = 1) as tc1,
          max(last_trade) as last_trade
        FROM final_trades
        GROUP BY cid_norm
        HAVING (p0 > 0.90 AND p1 < 0.10) OR (p1 > 0.90 AND p0 < 0.10)
      )
      SELECT
        '0x' || cid_norm as condition_id,
        CASE WHEN p0 > 0.90 THEN 0 ELSE 1 END as inferred_winner,
        p0 as outcome_0_price,
        p1 as outcome_1_price,
        tc0 as outcome_0_trades,
        tc1 as outcome_1_trades,
        CASE WHEN p0 > 0.90 THEN greatest(p0, 1.0 - p1) ELSE greatest(p1, 1.0 - p0) END as confidence,
        last_trade
      FROM outcome_prices
      ORDER BY confidence DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });

  const candidatesData = await candidates.json();
  console.log(`Found ${candidatesData.length} high-confidence recovery candidates:\n`);

  const candidateTable = candidatesData.map((c: any) => ({
    condition_id: c.condition_id.slice(0, 12) + '...',
    winner: c.inferred_winner,
    p0: Number(c.outcome_0_price).toFixed(3),
    p1: Number(c.outcome_1_price).toFixed(3),
    trades_0: c.outcome_0_trades,
    trades_1: c.outcome_1_trades,
    confidence: Number(c.confidence).toFixed(3),
    last_trade: c.last_trade,
  }));

  console.table(candidateTable);

  // Step 4: Generate SQL for insertion
  console.log('\n=== PHASE 4: DEPLOYMENT SQL ===\n');

  const deploySQL = `
-- Create view for trade-based resolution inference
CREATE OR REPLACE VIEW vw_resolutions_inferred_from_trades AS
WITH
unresolved AS (
  SELECT DISTINCT
    lower(replaceAll(cid, '0x', '')) as cid_norm
  FROM fact_trades_clean
  WHERE lower(replaceAll(cid, '0x', '')) NOT IN (
    SELECT condition_id_norm
    FROM market_resolutions_final
  )
),
final_trades AS (
  SELECT
    lower(replaceAll(ft.cid, '0x', '')) as cid_norm,
    ft.outcome_index,
    avg(toFloat64(ft.price)) as avg_price,
    count() as trade_count
  FROM fact_trades_clean ft
  INNER JOIN unresolved u ON lower(replaceAll(ft.cid, '0x', '')) = u.cid_norm
  WHERE ft.block_time >= (
    SELECT max(block_time) - INTERVAL 7 DAY
    FROM fact_trades_clean ft2
    WHERE lower(replaceAll(ft2.cid, '0x', '')) = lower(replaceAll(ft.cid, '0x', ''))
  )
  GROUP BY cid_norm, ft.outcome_index
),
outcome_prices AS (
  SELECT
    cid_norm,
    maxIf(avg_price, outcome_index = 0) as p0,
    maxIf(avg_price, outcome_index = 1) as p1,
    maxIf(trade_count, outcome_index = 0) + maxIf(trade_count, outcome_index = 1) as total_trades
  FROM final_trades
  GROUP BY cid_norm
  HAVING (p0 > 0.95 AND p1 < 0.05) OR (p1 > 0.95 AND p0 < 0.05)
    AND total_trades >= 10  -- Minimum trade requirement
)
SELECT
  cid_norm as condition_id_norm,
  CASE WHEN p0 > 0.95 THEN 0 ELSE 1 END as winning_index,
  CASE WHEN p0 > 0.95 THEN greatest(p0, 1.0 - p1) ELSE greatest(p1, 1.0 - p0) END as confidence,
  'trade_inference' as source,
  now() as inferred_at
FROM outcome_prices
WHERE confidence >= 0.95;

-- Insert high-confidence inferences into market_resolutions_final
INSERT INTO market_resolutions_final
  (condition_id_norm, winning_index, payout_numerators, payout_denominator,
   outcome_count, winning_outcome, source, version, updated_at)
SELECT
  condition_id_norm,
  winning_index,
  [1, 0] as payout_numerators,  -- Standard binary resolution
  1 as payout_denominator,
  2 as outcome_count,
  toString(winning_index) as winning_outcome,
  'trade_inference_v1' as source,
  1 as version,
  now() as updated_at
FROM vw_resolutions_inferred_from_trades
WHERE confidence >= 0.98  -- Only insert very high confidence (98%+)
LIMIT 1000;  -- Start with 1000 as proof-of-concept
`;

  console.log(deploySQL);

  console.log('\n=== SUMMARY ===\n');
  console.log(`1. Validation Accuracy: ${accuracy.toFixed(1)}%`);
  console.log(`2. Recoverable Markets: ${coverageData[0]?.recoverable_via_trades || 0} (${coverageData[0]?.recovery_pct || 0}%)`);
  console.log(`3. High-Confidence Candidates: ${candidatesData.length}`);

  if (accuracy >= 90) {
    console.log('\n✅ READY FOR DEPLOYMENT');
    console.log('   Next steps:');
    console.log('   1. Execute the deployment SQL above');
    console.log('   2. Monitor inserted resolutions for accuracy');
    console.log('   3. Gradually increase confidence threshold if results are good\n');
  } else {
    console.log('\n⚠️  NOT READY - Accuracy below 90%');
    console.log('   Recommend further tuning before deployment\n');
  }
}

main()
  .catch(console.error)
  .finally(() => client.close());
