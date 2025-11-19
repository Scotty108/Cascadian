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

async function redemptionInferenceFinal() {
  console.log('=== FINAL REDEMPTION-BASED WINNER INFERENCE ===\n');

  // First, check if ctf_token_map has condition_ids
  console.log('Step 1: Checking ctf_token_map quality...\n');

  const checkMap = `
    SELECT
      COUNT(*) as total_rows,
      COUNT(DISTINCT token_id) as unique_tokens,
      SUM(CASE WHEN condition_id_norm != '' THEN 1 ELSE 0 END) as rows_with_condition_id,
      COUNT(DISTINCT condition_id_norm) as unique_conditions
    FROM default.ctf_token_map
    WHERE condition_id_norm != ''
  `;

  const checkResult = await client.query({ query: checkMap, format: 'JSONEachRow' });
  const checkData = await checkResult.json();
  console.log('ctf_token_map quality:');
  console.log(JSON.stringify(checkData[0], null, 2));

  // If condition_ids are empty, we need to extract them from token_ids
  console.log('\n\nStep 2: Extracting condition_id from token_id (ERC1155 encoding)...\n');

  // ERC1155 token IDs encode: keccak256(condition_id, outcome_index)
  // We can reverse-engineer the condition_id by grouping tokens that were traded together

  const inferWinnersFromRedemptions = `
    WITH
    -- Get all redemption transactions
    redemption_txs AS (
      SELECT DISTINCT tx_hash
      FROM default.erc1155_transfers
      WHERE lower(to_address) = lower('${POLYMARKET_OPERATOR}')
    ),
    -- For each redemption tx, get all ERC1155 tokens transferred AND USDC payout
    redemption_details AS (
      SELECT
        r.tx_hash,
        r.from_address as redeemer,
        r.token_id,
        CAST(r.value AS Float64) as tokens_redeemed,
        u.usdc_paid,
        r.block_timestamp
      FROM (
        SELECT *
        FROM default.erc1155_transfers
        WHERE lower(to_address) = lower('${POLYMARKET_OPERATOR}')
      ) r
      LEFT JOIN (
        SELECT
          tx_hash,
          SUM(CAST(value AS Float64)) / 1e6 as usdc_paid
        FROM default.erc20_transfers
        WHERE lower(from_address) = lower('${CTF_CONTRACT}')
          AND lower(to_address) = lower('${POLYMARKET_OPERATOR}')
        GROUP BY tx_hash
      ) u ON r.tx_hash = u.tx_hash
      WHERE u.usdc_paid IS NOT NULL
    ),
    -- Map tokens to condition_ids and outcome_index
    redemptions_mapped AS (
      SELECT
        rd.tx_hash,
        rd.redeemer,
        rd.token_id,
        rd.tokens_redeemed,
        rd.usdc_paid,
        rd.block_timestamp,
        tm.outcome_index,
        CASE
          WHEN rd.tokens_redeemed > 0 THEN rd.usdc_paid / rd.tokens_redeemed
          ELSE 0
        END as redemption_ratio
      FROM redemption_details rd
      LEFT JOIN default.ctf_token_map tm ON lower(rd.token_id) = lower(tm.token_id)
      WHERE tm.outcome_index IS NOT NULL
    ),
    -- For tokens without condition_id in map, group by tx_hash to identify related tokens
    -- (tokens redeemed together likely belong to same condition)
    token_groups AS (
      SELECT
        token_id,
        outcome_index,
        COUNT(DISTINCT tx_hash) as redemption_count,
        COUNT(DISTINCT redeemer) as unique_redeemers,
        SUM(tokens_redeemed) as total_tokens,
        SUM(usdc_paid) as total_usdc,
        AVG(redemption_ratio) as avg_ratio,
        MIN(block_timestamp) as first_redemption,
        MAX(block_timestamp) as last_redemption
      FROM redemptions_mapped
      GROUP BY token_id, outcome_index
      HAVING unique_redeemers >= 2
    )
    -- Output token-level redemption stats
    SELECT
      token_id,
      outcome_index,
      unique_redeemers,
      total_tokens,
      total_usdc,
      avg_ratio,
      first_redemption,
      last_redemption,
      dateDiff('hour', first_redemption, last_redemption) as window_hours
    FROM token_groups
    ORDER BY total_usdc DESC
    LIMIT 100
  `;

  const inferResult = await client.query({ query: inferWinnersFromRedemptions, format: 'JSONEachRow' });
  const inferData = await inferResult.json();

  console.log(`\nFound ${inferData.length} tokens with redemption activity (mapped to outcomes)\n`);

  // Group tokens by their redemption patterns to identify condition sets
  console.log('Top 30 tokens by redemption volume:\n');

  inferData.slice(0, 30).forEach((item: any, i: number) => {
    console.log(`${i + 1}. Token: ${item.token_id.slice(0, 20)}...`);
    console.log(`   Outcome: ${item.outcome_index}`);
    console.log(`   Redeemers: ${item.unique_redeemers}`);
    console.log(`   Total USDC: $${parseFloat(item.total_usdc).toFixed(2)}`);
    console.log(`   Avg ratio: ${parseFloat(item.avg_ratio).toFixed(8)}`);
    console.log('');
  });

  // Now let's try to group these by examining which tokens appear together in transactions
  console.log('\n\nStep 3: Identifying condition groups from co-redemption patterns...\n');

  const coRedemptionAnalysis = `
    WITH
    -- Get all redemption transactions with their tokens
    redemption_tokens AS (
      SELECT
        r.tx_hash,
        r.token_id,
        tm.outcome_index,
        u.usdc_paid
      FROM default.erc1155_transfers r
      LEFT JOIN default.ctf_token_map tm ON lower(r.token_id) = lower(tm.token_id)
      LEFT JOIN (
        SELECT tx_hash, SUM(CAST(value AS Float64)) / 1e6 as usdc_paid
        FROM default.erc20_transfers
        WHERE lower(from_address) = lower('${CTF_CONTRACT}')
          AND lower(to_address) = lower('${POLYMARKET_OPERATOR}')
        GROUP BY tx_hash
      ) u ON r.tx_hash = u.tx_hash
      WHERE lower(r.to_address) = lower('${POLYMARKET_OPERATOR}')
        AND tm.outcome_index IS NOT NULL
        AND u.usdc_paid IS NOT NULL
    ),
    -- Find pairs of tokens that appear together (likely same condition, different outcomes)
    token_pairs AS (
      SELECT
        t1.token_id as token_a,
        t1.outcome_index as outcome_a,
        t2.token_id as token_b,
        t2.outcome_index as outcome_b,
        COUNT(DISTINCT t1.tx_hash) as co_occurrences,
        AVG(t1.usdc_paid) as avg_usdc
      FROM redemption_tokens t1
      JOIN redemption_tokens t2 ON t1.tx_hash = t2.tx_hash AND t1.token_id != t2.token_id
      GROUP BY token_a, outcome_a, token_b, outcome_b
      HAVING co_occurrences >= 2
    )
    SELECT *
    FROM token_pairs
    ORDER BY co_occurrences DESC
    LIMIT 50
  `;

  const coRedemptionResult = await client.query({ query: coRedemptionAnalysis, format: 'JSONEachRow' });
  const coRedemptionData = await coRedemptionResult.json();

  console.log(`Found ${coRedemptionData.length} token pairs that were co-redeemed (same condition, different outcomes):\n`);

  coRedemptionData.slice(0, 20).forEach((pair: any, i: number) => {
    console.log(`${i + 1}. Pair:`);
    console.log(`   Token A (outcome ${pair.outcome_a}): ${pair.token_a.slice(0, 16)}...`);
    console.log(`   Token B (outcome ${pair.outcome_b}): ${pair.token_b.slice(0, 16)}...`);
    console.log(`   Co-redeemed ${pair.co_occurrences} times`);
    console.log(`   Avg USDC per tx: $${parseFloat(pair.avg_usdc).toFixed(2)}`);
    console.log('');
  });

  // Final step: Build condition-level winner inference
  console.log('\n\nStep 4: Building final winner inference summary...\n');

  const summary = `
    SELECT
      COUNT(DISTINCT token_id) as unique_tokens_with_redemptions,
      SUM(unique_redeemers) as total_redeemers,
      SUM(total_usdc) as total_usdc_via_redemptions
    FROM (
      SELECT
        r.token_id,
        COUNT(DISTINCT r.from_address) as unique_redeemers,
        SUM(u.value) / 1e6 as total_usdc
      FROM default.erc1155_transfers r
      JOIN default.erc20_transfers u ON r.tx_hash = u.tx_hash
      WHERE lower(r.to_address) = lower('${POLYMARKET_OPERATOR}')
        AND lower(u.from_address) = lower('${CTF_CONTRACT}')
        AND lower(u.to_address) = lower('${POLYMARKET_OPERATOR}')
      GROUP BY r.token_id
    )
  `;

  const summaryResult = await client.query({ query: summary, format: 'JSONEachRow' });
  const summaryData = await summaryResult.json();

  console.log('Overall redemption statistics:');
  console.log(JSON.stringify(summaryData[0], null, 2));

  await client.close();
}

redemptionInferenceFinal().catch(console.error);
