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

async function inferWinnersFromRedemptions() {
  console.log('=== INFERRING WINNERS FROM REDEMPTION PATTERNS ===\n');

  // Step 1: Build redemption aggregation by token_id
  console.log('Step 1: Aggregating redemptions by token_id...\n');

  const redemptionAggregation = `
    WITH
    -- Get all ERC1155 transfers TO the operator (redemption requests)
    redemption_requests AS (
      SELECT
        tx_hash,
        from_address as redeemer,
        token_id,
        CAST(value AS Float64) as tokens_redeemed,
        block_timestamp,
        block_number
      FROM default.erc1155_transfers
      WHERE lower(to_address) = lower('${POLYMARKET_OPERATOR}')
    ),
    -- Get USDC payouts FROM CTF contract TO operator (in same transactions)
    usdc_payouts AS (
      SELECT
        tx_hash,
        CAST(value AS Float64) / 1e6 as usdc_paid,
        block_timestamp
      FROM default.erc20_transfers
      WHERE lower(from_address) = lower('${CTF_CONTRACT}')
        AND lower(to_address) = lower('${POLYMARKET_OPERATOR}')
    ),
    -- Join to get redemption ratio
    redemptions_with_payout AS (
      SELECT
        r.token_id,
        r.redeemer,
        r.tokens_redeemed,
        u.usdc_paid,
        r.tx_hash,
        r.block_timestamp,
        -- Calculate effective redemption ratio (USDC per token)
        CASE
          WHEN r.tokens_redeemed > 0 THEN u.usdc_paid / r.tokens_redeemed
          ELSE 0
        END as redemption_ratio
      FROM redemption_requests r
      JOIN usdc_payouts u ON r.tx_hash = u.tx_hash
    )
    -- Aggregate by token_id
    SELECT
      token_id,
      COUNT(DISTINCT redeemer) as unique_redeemers,
      COUNT(*) as redemption_count,
      SUM(tokens_redeemed) as total_tokens_redeemed,
      SUM(usdc_paid) as total_usdc_paid,
      AVG(redemption_ratio) as avg_redemption_ratio,
      MIN(redemption_ratio) as min_ratio,
      MAX(redemption_ratio) as max_ratio,
      MIN(block_timestamp) as first_redemption,
      MAX(block_timestamp) as last_redemption,
      dateDiff('hour', MIN(block_timestamp), MAX(block_timestamp)) as redemption_window_hours
    FROM redemptions_with_payout
    WHERE token_id != ''
    GROUP BY token_id
    HAVING unique_redeemers >= 2  -- Filter for tokens with multiple redeemers
    ORDER BY total_usdc_paid DESC
    LIMIT 100
  `;

  const aggResult = await client.query({ query: redemptionAggregation, format: 'JSONEachRow' });
  const aggData = await aggResult.json();

  console.log(`Found ${aggData.length} tokens with redemption activity (2+ redeemers)`);
  console.log('\nTop 20 tokens by total USDC paid:\n');

  aggData.slice(0, 20).forEach((item: any, i: number) => {
    console.log(`${i + 1}. Token ID: ${item.token_id.slice(0, 20)}...`);
    console.log(`   Redeemers: ${item.unique_redeemers}`);
    console.log(`   Total redeemed: ${item.total_tokens_redeemed} tokens`);
    console.log(`   Total USDC paid: $${parseFloat(item.total_usdc_paid).toFixed(2)}`);
    console.log(`   Avg ratio: ${parseFloat(item.avg_redemption_ratio).toFixed(6)} USDC/token`);
    console.log(`   Redemption window: ${item.redemption_window_hours} hours`);
    console.log('');
  });

  // Step 2: Map token_ids to condition_ids
  console.log('\nStep 2: Mapping token_ids to condition_ids...\n');

  const tokenMapping = `
    SELECT
      name,
      type
    FROM system.columns
    WHERE database = 'default'
      AND table IN ('erc1155_condition_map', 'ctf_token_map', 'token_condition_market_map')
    ORDER BY table, position
  `;

  const mappingResult = await client.query({ query: tokenMapping, format: 'JSONEachRow' });
  const mappingSchema = await mappingResult.json();

  console.log('Available token mapping tables and their schemas:');
  console.log(JSON.stringify(mappingSchema, null, 2));

  // Step 3: Check which mapping table to use
  console.log('\n\nStep 3: Checking token_condition_market_map table...\n');

  const checkMapping = `
    SELECT
      COUNT(*) as row_count,
      COUNT(DISTINCT token_id) as unique_tokens
    FROM cascadian_clean.token_condition_market_map
    LIMIT 1
  `;

  try {
    const checkResult = await client.query({ query: checkMapping, format: 'JSONEachRow' });
    const checkData = await checkResult.json();
    console.log('token_condition_market_map stats:');
    console.log(JSON.stringify(checkData[0], null, 2));

    // Step 4: Join redemption data with token mapping
    console.log('\n\nStep 4: Mapping redeemed tokens to condition_ids...\n');

    const mapToConditions = `
      WITH redemption_summary AS (
        SELECT
          token_id,
          COUNT(DISTINCT redeemer) as unique_redeemers,
          SUM(tokens_redeemed) as total_tokens_redeemed,
          SUM(usdc_paid) as total_usdc_paid,
          AVG(redemption_ratio) as avg_redemption_ratio
        FROM (
          SELECT
            r.token_id,
            r.from_address as redeemer,
            CAST(r.value AS Float64) as tokens_redeemed,
            u.value / 1e6 as usdc_paid,
            (u.value / 1e6) / CAST(r.value AS Float64) as redemption_ratio
          FROM default.erc1155_transfers r
          JOIN default.erc20_transfers u ON r.tx_hash = u.tx_hash
          WHERE lower(r.to_address) = lower('${POLYMARKET_OPERATOR}')
            AND lower(u.from_address) = lower('${CTF_CONTRACT}')
            AND lower(u.to_address) = lower('${POLYMARKET_OPERATOR}')
        )
        GROUP BY token_id
        HAVING unique_redeemers >= 2
      )
      SELECT
        lower(replaceAll(m.condition_id, '0x', '')) as condition_id_norm,
        m.token_id,
        m.outcome_index,
        r.unique_redeemers,
        r.total_usdc_paid,
        r.avg_redemption_ratio
      FROM redemption_summary r
      LEFT JOIN cascadian_clean.token_condition_market_map m
        ON lower(r.token_id) = lower(m.token_id)
      WHERE m.condition_id IS NOT NULL
      ORDER BY r.total_usdc_paid DESC
      LIMIT 50
    `;

    const mapResult = await client.query({ query: mapToConditions, format: 'JSONEachRow' });
    const mapData = await mapResult.json();

    console.log(`\nMapped ${mapData.length} redeemed tokens to condition_ids:`);
    console.log(JSON.stringify(mapData.slice(0, 20), null, 2));

    // Step 5: Infer winners by grouping by condition_id
    console.log('\n\nStep 5: Inferring winners by condition_id...\n');

    const inferWinners = `
      WITH redemption_by_outcome AS (
        SELECT
          lower(replaceAll(m.condition_id, '0x', '')) as condition_id_norm,
          m.outcome_index,
          COUNT(DISTINCT r.from_address) as unique_redeemers,
          SUM(CAST(r.value AS Float64)) as total_tokens_redeemed,
          SUM(u.value) / 1e6 as total_usdc_paid,
          AVG((u.value / 1e6) / CAST(r.value AS Float64)) as avg_redemption_ratio
        FROM default.erc1155_transfers r
        JOIN default.erc20_transfers u ON r.tx_hash = u.tx_hash
        LEFT JOIN cascadian_clean.token_condition_market_map m ON lower(r.token_id) = lower(m.token_id)
        WHERE lower(r.to_address) = lower('${POLYMARKET_OPERATOR}')
          AND lower(u.from_address) = lower('${CTF_CONTRACT}')
          AND lower(u.to_address) = lower('${POLYMARKET_OPERATOR}')
          AND m.condition_id IS NOT NULL
        GROUP BY condition_id_norm, m.outcome_index
      ),
      ranked_by_condition AS (
        SELECT
          condition_id_norm,
          outcome_index,
          unique_redeemers,
          total_usdc_paid,
          avg_redemption_ratio,
          ROW_NUMBER() OVER (PARTITION BY condition_id_norm ORDER BY total_usdc_paid DESC) as rank_by_volume,
          ROW_NUMBER() OVER (PARTITION BY condition_id_norm ORDER BY avg_redemption_ratio DESC) as rank_by_ratio
        FROM redemption_by_outcome
      )
      SELECT
        condition_id_norm,
        outcome_index,
        unique_redeemers,
        total_usdc_paid,
        avg_redemption_ratio,
        rank_by_volume,
        rank_by_ratio,
        CASE
          WHEN rank_by_volume = 1 AND rank_by_ratio = 1 THEN 'HIGH_CONFIDENCE'
          WHEN rank_by_volume = 1 OR rank_by_ratio = 1 THEN 'MEDIUM_CONFIDENCE'
          ELSE 'LOW_CONFIDENCE'
        END as confidence
      FROM ranked_by_condition
      WHERE rank_by_volume <= 2  -- Show top 2 outcomes per condition
      ORDER BY condition_id_norm, rank_by_volume
      LIMIT 100
    `;

    const inferResult = await client.query({ query: inferWinners, format: 'JSONEachRow' });
    const inferData = await inferResult.json();

    console.log(`\nInferred winners for ${inferData.length} outcome positions:`);

    // Group by condition_id
    const byCondition = new Map<string, any[]>();
    inferData.forEach((item: any) => {
      if (!byCondition.has(item.condition_id_norm)) {
        byCondition.set(item.condition_id_norm, []);
      }
      byCondition.get(item.condition_id_norm)!.push(item);
    });

    console.log(`\nFound ${byCondition.size} unique conditions with redemption data:\n`);

    let highConfCount = 0;
    Array.from(byCondition.entries()).slice(0, 20).forEach(([condId, outcomes]) => {
      console.log(`Condition: ${condId.slice(0, 16)}...`);
      outcomes.forEach((outcome: any) => {
        const isWinner = outcome.rank_by_volume === '1';
        console.log(`  ${isWinner ? '🏆' : '  '} Outcome ${outcome.outcome_index}: ${outcome.confidence}`);
        console.log(`     Redeemers: ${outcome.unique_redeemers}, USDC: $${parseFloat(outcome.total_usdc_paid).toFixed(2)}`);
        console.log(`     Ratio: ${parseFloat(outcome.avg_redemption_ratio).toFixed(6)}`);
        if (isWinner && outcome.confidence === 'HIGH_CONFIDENCE') {
          highConfCount++;
        }
      });
      console.log('');
    });

    console.log(`\n=== SUMMARY ===`);
    console.log(`High confidence winners detected: ${highConfCount}`);
    console.log(`Total conditions with redemption data: ${byCondition.size}`);
    console.log(`Coverage potential: ${(highConfCount / byCondition.size * 100).toFixed(1)}% high confidence`);

  } catch (e: any) {
    console.log(`Error accessing token_condition_market_map: ${e.message}`);
    console.log('\nTrying alternative approach with direct token analysis...');
  }

  await client.close();
}

inferWinnersFromRedemptions().catch(console.error);
