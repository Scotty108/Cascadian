import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const CHOSEN_VIEW = 'vw_trades_canonical_current';
const XCNSTRATEGY_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function debugPnLJoin() {
  console.log('=== Debugging PnL Join ===\n');

  // Step 1: Check how many positions we have
  console.log('Step 1: Checking positions for this wallet...\n');

  const positionsQuery = `
    SELECT
      canonical_condition_id,
      canonical_outcome_index,
      count() AS trade_count,
      sum(if(trade_direction = 'BUY', shares, -shares)) AS net_shares,
      sum(if(trade_direction = 'BUY', usd_value, -usd_value)) AS net_cost
    FROM ${CHOSEN_VIEW}
    WHERE lower(wallet_address) = lower('${XCNSTRATEGY_WALLET}')
      AND canonical_condition_id IS NOT NULL
      AND canonical_condition_id != ''
      AND canonical_condition_id != '0000000000000000000000000000000000000000000000000000000000000000'
    GROUP BY canonical_condition_id, canonical_outcome_index
    ORDER BY abs(net_shares) DESC
    LIMIT 10
  `;

  const posResult = await clickhouse.query({ query: positionsQuery, format: 'JSONEachRow' });
  const positions = await posResult.json<any[]>();

  console.log(`Found ${positions.length > 0 ? positions.length + '+' : '0'} unique positions\n`);

  if (positions.length > 0) {
    console.log('Top 10 positions by shares:');
    console.log('');
    positions.forEach((p, i) => {
      console.log(`${i + 1}. Condition: ${p.canonical_condition_id.substring(0, 12)}...`);
      console.log(`   Outcome: ${p.canonical_outcome_index}, Shares: ${Number(p.net_shares).toFixed(2)}, Cost: $${Number(p.net_cost).toFixed(2)}`);
    });
    console.log('');

    // Step 2: Check if these conditions exist in resolutions
    console.log('Step 2: Checking if these conditions have resolutions...\n');

    const sampleCondition = positions[0].canonical_condition_id;

    const resolutionQuery = `
      SELECT
        condition_id_norm,
        winning_index,
        payout_numerators,
        payout_denominator,
        resolved_at
      FROM market_resolutions_final
      WHERE condition_id_norm = '${sampleCondition}'
    `;

    const resResult = await clickhouse.query({ query: resolutionQuery, format: 'JSONEachRow' });
    const resolutions = await resResult.json<any[]>();

    if (resolutions.length > 0) {
      console.log(`✓ Found resolution for sample condition: ${sampleCondition.substring(0, 12)}...`);
      console.log('  Resolution data:', JSON.stringify(resolutions[0], null, 2));
    } else {
      console.log(`✗ No resolution found for sample condition: ${sampleCondition.substring(0, 12)}...`);
      console.log('');
      console.log('Checking if there are ANY resolutions in the table...');

      const anyResQuery = `SELECT count() AS total FROM market_resolutions_final`;
      const anyResResult = await clickhouse.query({ query: anyResQuery, format: 'JSONEachRow' });
      const anyResData = await anyResResult.json<any[]>();

      console.log(`  Total resolutions in table: ${anyResData[0].total}`);
      console.log('');

      // Check format of condition IDs in resolutions
      console.log('Sample condition IDs from resolutions:');
      const sampleResQuery = `SELECT condition_id_norm FROM market_resolutions_final LIMIT 5`;
      const sampleResResult = await clickhouse.query({ query: sampleResQuery, format: 'JSONEachRow' });
      const sampleResData = await sampleResResult.json<any[]>();

      sampleResData.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.condition_id_norm}`);
      });
      console.log('');

      // Check if the format matches
      console.log('Comparing formats:');
      console.log(`  Trades condition ID: ${sampleCondition} (length: ${sampleCondition.length})`);
      if (sampleResData.length > 0) {
        console.log(`  Resolution ID:       ${sampleResData[0].condition_id_norm} (length: ${sampleResData[0].condition_id_norm.length})`);
      }
    }
    console.log('');

    // Step 3: Try to count how many positions have resolutions
    console.log('Step 3: Counting how many of this wallet\'s positions have resolutions...\n');

    const matchQuery = `
      WITH positions AS (
        SELECT DISTINCT canonical_condition_id
        FROM ${CHOSEN_VIEW}
        WHERE lower(wallet_address) = lower('${XCNSTRATEGY_WALLET}')
          AND canonical_condition_id IS NOT NULL
          AND canonical_condition_id != ''
          AND canonical_condition_id != '0000000000000000000000000000000000000000000000000000000000000000'
      )
      SELECT
        count() AS total_positions,
        countIf(r.condition_id_norm IS NOT NULL) AS positions_with_resolution
      FROM positions p
      LEFT JOIN market_resolutions_final r
        ON p.canonical_condition_id = r.condition_id_norm
    `;

    const matchResult = await clickhouse.query({ query: matchQuery, format: 'JSONEachRow' });
    const matchData = await matchResult.json<any[]>();

    console.log(`Total unique positions: ${matchData[0].total_positions}`);
    console.log(`Positions with resolutions: ${matchData[0].positions_with_resolution}`);
    console.log(`Coverage: ${(Number(matchData[0].positions_with_resolution) / Number(matchData[0].total_positions) * 100).toFixed(1)}%`);
    console.log('');
  } else {
    console.log('No positions found for this wallet.');
  }
}

debugPnLJoin().catch(console.error);
