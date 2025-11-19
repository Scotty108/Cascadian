import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

const CTF_CONTRACT = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045';
const POLYMARKET_OPERATOR = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

async function inferWinnersComplete() {
  console.log('=== COMPLETE REDEMPTION-BASED WINNER INFERENCE ===\n');

  // Step 1: Check token mapping table
  console.log('Step 1: Checking token mapping table schema...\n');

  const checkTable = `
    SELECT *
    FROM cascadian_clean.token_condition_market_map
    LIMIT 5
  `;

  try {
    const checkResult = await client.query({ query: checkTable, format: 'JSONEachRow' });
    const sampleData = await checkResult.json();
    console.log('Sample rows from token_condition_market_map:');
    console.log(JSON.stringify(sampleData, null, 2));
  } catch (e: any) {
    console.log(`Error: ${e.message}\n`);
  }

  // Step 2: Build complete redemption-to-condition mapping
  console.log('\n\nStep 2: Mapping redemptions to conditions and inferring winners...\n');

  const inferWinners = `
    WITH
    -- Redemption requests: ERC1155 transfers TO operator
    redemption_requests AS (
      SELECT
        tx_hash,
        from_address as redeemer,
        token_id,
        CAST(value AS Float64) as tokens_redeemed,
        block_timestamp
      FROM default.erc1155_transfers
      WHERE lower(to_address) = lower('${POLYMARKET_OPERATOR}')
        AND token_id != ''
    ),
    -- USDC payouts: CTF → operator
    usdc_payouts AS (
      SELECT
        tx_hash,
        CAST(value AS Float64) / 1e6 as usdc_paid
      FROM default.erc20_transfers
      WHERE lower(from_address) = lower('${CTF_CONTRACT}')
        AND lower(to_address) = lower('${POLYMARKET_OPERATOR}')
    ),
    -- Join redemptions with payouts
    redemptions_matched AS (
      SELECT
        r.token_id,
        r.redeemer,
        r.tokens_redeemed,
        u.usdc_paid,
        r.tx_hash,
        r.block_timestamp,
        CASE
          WHEN r.tokens_redeemed > 0 THEN u.usdc_paid / r.tokens_redeemed
          ELSE 0
        END as redemption_ratio
      FROM redemption_requests r
      INNER JOIN usdc_payouts u ON r.tx_hash = u.tx_hash
      WHERE r.tokens_redeemed > 0
    ),
    -- Aggregate by token_id
    token_redemption_stats AS (
      SELECT
        token_id,
        COUNT(DISTINCT redeemer) as unique_redeemers,
        SUM(tokens_redeemed) as total_tokens,
        SUM(usdc_paid) as total_usdc,
        AVG(redemption_ratio) as avg_ratio,
        MIN(block_timestamp) as first_redemption,
        MAX(block_timestamp) as last_redemption
      FROM redemptions_matched
      GROUP BY token_id
      HAVING unique_redeemers >= 2
    ),
    -- Map tokens to conditions (using cascadian_clean mapping)
    tokens_with_conditions AS (
      SELECT
        t.token_id,
        lower(replaceAll(m.condition_id_norm, '0x', '')) as condition_id,
        m.outcome_index,
        t.unique_redeemers,
        t.total_tokens,
        t.total_usdc,
        t.avg_ratio,
        t.first_redemption,
        t.last_redemption
      FROM token_redemption_stats t
      LEFT JOIN cascadian_clean.token_condition_market_map m
        ON lower(t.token_id) = lower(m.token_id)
      WHERE m.condition_id_norm IS NOT NULL AND m.condition_id_norm != ''
    ),
    -- Aggregate by condition_id and outcome
    outcome_stats AS (
      SELECT
        condition_id,
        outcome_index,
        SUM(unique_redeemers) as total_redeemers,
        SUM(total_usdc) as outcome_usdc,
        AVG(avg_ratio) as outcome_ratio,
        MIN(first_redemption) as first_redeem,
        MAX(last_redemption) as last_redeem
      FROM tokens_with_conditions
      GROUP BY condition_id, outcome_index
    ),
    -- Rank outcomes within each condition
    ranked_outcomes AS (
      SELECT
        condition_id,
        outcome_index,
        total_redeemers,
        outcome_usdc,
        outcome_ratio,
        first_redeem,
        last_redeem,
        ROW_NUMBER() OVER (
          PARTITION BY condition_id
          ORDER BY outcome_usdc DESC
        ) as rank_by_usdc,
        ROW_NUMBER() OVER (
          PARTITION BY condition_id
          ORDER BY total_redeemers DESC
        ) as rank_by_redeemers,
        ROW_NUMBER() OVER (
          PARTITION BY condition_id
          ORDER BY outcome_ratio DESC
        ) as rank_by_ratio
      FROM outcome_stats
    )
    -- Final output: winners with confidence scoring
    SELECT
      condition_id,
      outcome_index,
      total_redeemers,
      outcome_usdc,
      outcome_ratio,
      rank_by_usdc,
      rank_by_redeemers,
      rank_by_ratio,
      dateDiff('hour', first_redeem, last_redeem) as redemption_window_hours,
      CASE
        -- High confidence: top in all 3 metrics
        WHEN rank_by_usdc = 1 AND rank_by_redeemers = 1 AND rank_by_ratio = 1
          THEN 'HIGH'
        -- Medium confidence: top in 2 of 3 metrics
        WHEN (rank_by_usdc = 1 AND rank_by_redeemers = 1)
          OR (rank_by_usdc = 1 AND rank_by_ratio = 1)
          OR (rank_by_redeemers = 1 AND rank_by_ratio = 1)
          THEN 'MEDIUM'
        -- Low confidence: top in only 1 metric
        ELSE 'LOW'
      END as confidence,
      CASE
        WHEN rank_by_usdc = 1 THEN 1
        ELSE 0
      END as is_inferred_winner
    FROM ranked_outcomes
    WHERE rank_by_usdc <= 2  -- Show top 2 per condition for comparison
    ORDER BY condition_id, rank_by_usdc
    LIMIT 200
  `;

  const inferResult = await client.query({ query: inferWinners, format: 'JSONEachRow' });
  const inferData = await inferResult.json();

  console.log(`Found ${inferData.length} outcome positions across conditions with redemption data\n`);

  // Group by condition_id
  const byCondition = new Map<string, any[]>();
  inferData.forEach((item: any) => {
    if (!byCondition.has(item.condition_id)) {
      byCondition.set(item.condition_id, []);
    }
    byCondition.get(item.condition_id)!.push(item);
  });

  console.log(`Conditions with redemption-based inference: ${byCondition.size}\n`);

  // Count confidence levels
  let highConf = 0;
  let mediumConf = 0;
  let lowConf = 0;

  Array.from(byCondition.entries()).slice(0, 30).forEach(([condId, outcomes]) => {
    console.log(`\nCondition: ${condId.slice(0, 16)}...`);
    outcomes.forEach((outcome: any) => {
      const isWinner = outcome.is_inferred_winner === '1';
      const symbol = isWinner ? '🏆' : '  ';
      console.log(`  ${symbol} Outcome ${outcome.outcome_index} [${outcome.confidence} confidence]`);
      console.log(`     Redeemers: ${outcome.total_redeemers}, USDC: $${parseFloat(outcome.outcome_usdc).toFixed(2)}`);
      console.log(`     Avg ratio: ${parseFloat(outcome.outcome_ratio).toFixed(8)}`);
      console.log(`     Rankings - USDC: ${outcome.rank_by_usdc}, Redeemers: ${outcome.rank_by_redeemers}, Ratio: ${outcome.rank_by_ratio}`);

      if (isWinner) {
        if (outcome.confidence === 'HIGH') highConf++;
        else if (outcome.confidence === 'MEDIUM') mediumConf++;
        else lowConf++;
      }
    });
  });

  console.log('\n\n=== SUMMARY ===');
  console.log(`Total conditions with redemption data: ${byCondition.size}`);
  console.log(`Inferred winners by confidence:`);
  console.log(`  HIGH confidence:   ${highConf} (${(highConf / byCondition.size * 100).toFixed(1)}%)`);
  console.log(`  MEDIUM confidence: ${mediumConf} (${(mediumConf / byCondition.size * 100).toFixed(1)}%)`);
  console.log(`  LOW confidence:    ${lowConf} (${(lowConf / byCondition.size * 100).toFixed(1)}%)`);
  console.log(`\nTotal usable inferences: ${highConf + mediumConf} (${((highConf + mediumConf) / byCondition.size * 100).toFixed(1)}%)`);

  // Step 3: Cross-validate against known resolutions
  console.log('\n\nStep 3: Cross-validating against known resolutions...\n');

  const crossValidate = `
    WITH
    inferred_winners AS (
      -- Same CTE logic as above, abbreviated for clarity
      SELECT
        condition_id,
        outcome_index as inferred_winner
      FROM (
        SELECT
          condition_id,
          outcome_index,
          ROW_NUMBER() OVER (PARTITION BY condition_id ORDER BY outcome_usdc DESC) as rank
        FROM (
          SELECT
            lower(replaceAll(m.condition_id_norm, '0x', '')) as condition_id,
            m.outcome_index,
            SUM(r.usdc_paid) as outcome_usdc
          FROM (
            SELECT
              rr.token_id,
              up.usdc_paid
            FROM (
              SELECT token_id, tx_hash, CAST(value AS Float64) as tokens
              FROM default.erc1155_transfers
              WHERE lower(to_address) = lower('${POLYMARKET_OPERATOR}')
            ) rr
            INNER JOIN (
              SELECT tx_hash, CAST(value AS Float64) / 1e6 as usdc_paid
              FROM default.erc20_transfers
              WHERE lower(from_address) = lower('${CTF_CONTRACT}')
                AND lower(to_address) = lower('${POLYMARKET_OPERATOR}')
            ) up ON rr.tx_hash = up.tx_hash
          ) r
          LEFT JOIN cascadian_clean.token_condition_market_map m
            ON lower(r.token_id) = lower(m.token_id)
          WHERE m.condition_id_norm IS NOT NULL
          GROUP BY condition_id, m.outcome_index
        )
      )
      WHERE rank = 1
    ),
    known_resolutions AS (
      SELECT
        lower(replaceAll(condition_id, '0x', '')) as condition_id,
        CAST(winning_index AS UInt8) as actual_winner
      FROM cascadian_clean.resolutions_by_cid
      WHERE winning_index IS NOT NULL
    )
    SELECT
      COUNT(*) as overlap_count,
      SUM(CASE WHEN i.inferred_winner = k.actual_winner THEN 1 ELSE 0 END) as matches,
      SUM(CASE WHEN i.inferred_winner != k.actual_winner THEN 1 ELSE 0 END) as mismatches,
      (SUM(CASE WHEN i.inferred_winner = k.actual_winner THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) as accuracy_pct
    FROM inferred_winners i
    INNER JOIN known_resolutions k ON i.condition_id = k.condition_id
  `;

  const validateResult = await client.query({ query: crossValidate, format: 'JSONEachRow' });
  const validateData = await validateResult.json();

  console.log('Cross-validation results:');
  console.log(JSON.stringify(validateData[0], null, 2));

  await client.close();
}

inferWinnersComplete().catch(console.error);
