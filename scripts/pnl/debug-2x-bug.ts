#!/usr/bin/env npx tsx
/**
 * Debug 2x Bug Investigation
 *
 * For wallet 0x5867... (showed exactly 2x loss):
 *   - UI: -$341.38
 *   - V17: -$683.06
 *
 * Checks:
 * A) JOIN fanout - does the token map create duplicates?
 * B) Both legs counted - are maker+taker both included?
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

const WALLET = '0x586744c62f4b87872d4e616e1273b88b5eb324b3';

async function main() {
  console.log('='.repeat(80));
  console.log('2X BUG INVESTIGATION - Wallet 0x5867...');
  console.log('='.repeat(80));
  console.log('Expected: UI shows -$341.38, V17 shows -$683.06 (exactly 2x)');
  console.log();

  // ============================================================================
  // CHECK A: Row counts before and after JOIN
  // ============================================================================
  console.log('CHECK A: JOIN FANOUT');
  console.log('-'.repeat(40));

  // Count distinct event_ids BEFORE join
  const preJoinQuery = `
    SELECT
      count() as total_rows,
      count(DISTINCT event_id) as distinct_event_ids
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = lower('${WALLET}')
  `;
  const preJoinResult = await clickhouse.query({ query: preJoinQuery, format: 'JSONEachRow' });
  const preJoin = (await preJoinResult.json())[0] as any;
  console.log(`Pre-JOIN (fills table):`);
  console.log(`  Total rows: ${preJoin.total_rows}`);
  console.log(`  Distinct event_ids: ${preJoin.distinct_event_ids}`);
  console.log(`  Ratio: ${(Number(preJoin.total_rows) / Number(preJoin.distinct_event_ids)).toFixed(2)}x`);

  // Count AFTER join to token map
  const postJoinQuery = `
    SELECT
      count() as total_rows,
      count(DISTINCT f.event_id) as distinct_event_ids
    FROM pm_trader_events_dedup_v2_tbl f
    INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
    WHERE lower(f.trader_wallet) = lower('${WALLET}')
  `;
  const postJoinResult = await clickhouse.query({ query: postJoinQuery, format: 'JSONEachRow' });
  const postJoin = (await postJoinResult.json())[0] as any;
  console.log(`Post-JOIN (with token map):`);
  console.log(`  Total rows: ${postJoin.total_rows}`);
  console.log(`  Distinct event_ids: ${postJoin.distinct_event_ids}`);
  console.log(`  Ratio: ${(Number(postJoin.total_rows) / Number(postJoin.distinct_event_ids)).toFixed(2)}x`);

  // Check for fanout
  const fanoutRatio = Number(postJoin.total_rows) / Number(preJoin.total_rows);
  if (fanoutRatio > 1.1) {
    console.log(`\n⚠️ FANOUT DETECTED: ${fanoutRatio.toFixed(2)}x more rows after JOIN`);
  } else {
    console.log(`\n✓ No significant fanout from JOIN (${fanoutRatio.toFixed(2)}x)`);
  }

  // ============================================================================
  // CHECK A2: Token map uniqueness
  // ============================================================================
  console.log('\n' + '-'.repeat(40));
  console.log('CHECK A2: TOKEN MAP UNIQUENESS');
  console.log('-'.repeat(40));

  // Check for duplicate token_id_dec in map
  const mapDupQuery = `
    SELECT token_id_dec, count() as cnt
    FROM pm_token_to_condition_map_v5
    GROUP BY token_id_dec
    HAVING cnt > 1
    LIMIT 10
  `;
  const mapDupResult = await clickhouse.query({ query: mapDupQuery, format: 'JSONEachRow' });
  const mapDups = (await mapDupResult.json()) as any[];

  if (mapDups.length > 0) {
    console.log(`⚠️ DUPLICATE TOKEN MAPPINGS FOUND:`);
    mapDups.forEach((r) => console.log(`  token_id_dec ${r.token_id_dec}: ${r.cnt} rows`));
  } else {
    console.log(`✓ Token map is unique (no duplicate token_id_dec)`);
  }

  // ============================================================================
  // CHECK B: Both legs counted?
  // ============================================================================
  console.log('\n' + '-'.repeat(40));
  console.log('CHECK B: MAKER/TAKER BOTH COUNTED?');
  console.log('-'.repeat(40));

  // Check role distribution
  const roleQuery = `
    SELECT
      role,
      count() as cnt,
      count(DISTINCT event_id) as distinct_events
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = lower('${WALLET}')
    GROUP BY role
  `;
  const roleResult = await clickhouse.query({ query: roleQuery, format: 'JSONEachRow' });
  const roles = (await roleResult.json()) as any[];
  console.log('Role distribution:');
  roles.forEach((r) => console.log(`  ${r.role}: ${r.cnt} rows, ${r.distinct_events} distinct events`));

  // Check if same event_id has both maker AND taker rows for this wallet
  const bothLegsQuery = `
    SELECT count() as cnt FROM (
      SELECT event_id, groupUniqArray(role) as roles
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = lower('${WALLET}')
      GROUP BY event_id
      HAVING has(roles, 'maker') AND has(roles, 'taker')
    )
  `;
  const bothLegsResult = await clickhouse.query({ query: bothLegsQuery, format: 'JSONEachRow' });
  const bothLegs = (await bothLegsResult.json())[0] as any;
  console.log(`\nEvents with BOTH maker AND taker rows: ${bothLegs.cnt}`);

  // ============================================================================
  // CHECK C: Duplicate event_ids in source table
  // ============================================================================
  console.log('\n' + '-'.repeat(40));
  console.log('CHECK C: DUPLICATE EVENT_IDS IN SOURCE');
  console.log('-'.repeat(40));

  const dupEventsQuery = `
    SELECT event_id, count() as cnt
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = lower('${WALLET}')
    GROUP BY event_id
    HAVING cnt > 1
    ORDER BY cnt DESC
    LIMIT 10
  `;
  const dupEventsResult = await clickhouse.query({ query: dupEventsQuery, format: 'JSONEachRow' });
  const dupEvents = (await dupEventsResult.json()) as any[];

  if (dupEvents.length > 0) {
    console.log(`⚠️ DUPLICATE EVENT_IDS FOUND (top 10):`);
    dupEvents.forEach((r) => console.log(`  ${r.event_id}: ${r.cnt} rows`));

    // Show details of first duplicate
    const firstDup = dupEvents[0].event_id;
    const detailQuery = `
      SELECT event_id, side, role, token_amount/1e6 as tokens, usdc_amount/1e6 as usdc
      FROM pm_trader_events_dedup_v2_tbl
      WHERE event_id = '${firstDup}'
      ORDER BY role
    `;
    const detailResult = await clickhouse.query({ query: detailQuery, format: 'JSONEachRow' });
    const details = (await detailResult.json()) as any[];
    console.log(`\nDetail for first duplicate ${firstDup}:`);
    details.forEach((r) =>
      console.log(`  role=${r.role}, side=${r.side}, tokens=${Number(r.tokens).toFixed(2)}, usdc=${Number(r.usdc).toFixed(2)}`)
    );
  } else {
    console.log(`✓ No duplicate event_ids in source table`);
  }

  // ============================================================================
  // CHECK D: Calculate with explicit dedup and compare
  // ============================================================================
  console.log('\n' + '-'.repeat(40));
  console.log('CHECK D: CALCULATE WITH EXPLICIT DEDUP');
  console.log('-'.repeat(40));

  // Calculate PnL with GROUP BY event_id dedup (what V17 should do)
  const dedupCalcQuery = `
    SELECT
      sum(sell_usdc - buy_usdc) as cash_flow,
      sum(buy_tokens - sell_tokens) as final_shares,
      count() as positions
    FROM (
      SELECT
        condition_id,
        outcome_index,
        sum(if(side = 'buy', tokens, 0)) as buy_tokens,
        sum(if(side = 'sell', tokens, 0)) as sell_tokens,
        sum(if(side = 'buy', usdc, 0)) as buy_usdc,
        sum(if(side = 'sell', usdc, 0)) as sell_usdc
      FROM (
        SELECT
          any(lower(f.side)) as side,
          any(f.token_amount) / 1e6 as tokens,
          any(f.usdc_amount) / 1e6 as usdc,
          any(m.condition_id) as condition_id,
          any(m.outcome_index) as outcome_index
        FROM pm_trader_events_dedup_v2_tbl f
        INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
        WHERE lower(f.trader_wallet) = lower('${WALLET}')
        GROUP BY f.event_id  -- DEDUP HERE
      )
      GROUP BY condition_id, outcome_index
    )
  `;
  const dedupCalcResult = await clickhouse.query({ query: dedupCalcQuery, format: 'JSONEachRow' });
  const dedupCalc = (await dedupCalcResult.json())[0] as any;
  console.log(`With GROUP BY event_id dedup:`);
  console.log(`  Cash flow: $${Number(dedupCalc.cash_flow).toFixed(2)}`);
  console.log(`  Final shares: ${Number(dedupCalc.final_shares).toFixed(2)}`);
  console.log(`  Positions: ${dedupCalc.positions}`);

  // Calculate WITHOUT dedup (to see the doubling)
  const noDedupCalcQuery = `
    SELECT
      sum(sell_usdc - buy_usdc) as cash_flow,
      sum(buy_tokens - sell_tokens) as final_shares,
      count() as positions
    FROM (
      SELECT
        m.condition_id,
        m.outcome_index,
        sum(if(lower(f.side) = 'buy', f.token_amount / 1e6, 0)) as buy_tokens,
        sum(if(lower(f.side) = 'sell', f.token_amount / 1e6, 0)) as sell_tokens,
        sum(if(lower(f.side) = 'buy', f.usdc_amount / 1e6, 0)) as buy_usdc,
        sum(if(lower(f.side) = 'sell', f.usdc_amount / 1e6, 0)) as sell_usdc
      FROM pm_trader_events_dedup_v2_tbl f
      INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
      WHERE lower(f.trader_wallet) = lower('${WALLET}')
      GROUP BY m.condition_id, m.outcome_index
    )
  `;
  const noDedupCalcResult = await clickhouse.query({ query: noDedupCalcQuery, format: 'JSONEachRow' });
  const noDedupCalc = (await noDedupCalcResult.json())[0] as any;
  console.log(`\nWITHOUT GROUP BY event_id dedup:`);
  console.log(`  Cash flow: $${Number(noDedupCalc.cash_flow).toFixed(2)}`);
  console.log(`  Final shares: ${Number(noDedupCalc.final_shares).toFixed(2)}`);
  console.log(`  Positions: ${noDedupCalc.positions}`);

  const cashFlowRatio = Number(noDedupCalc.cash_flow) / Number(dedupCalc.cash_flow);
  console.log(`\nCash flow ratio (no-dedup / dedup): ${cashFlowRatio.toFixed(2)}x`);

  if (Math.abs(cashFlowRatio - 2) < 0.1) {
    console.log(`\n🔴 ROOT CAUSE CONFIRMED: Deduplication is the issue!`);
    console.log(`   The source table has ~2x rows per event_id.`);
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const preRatio = Number(preJoin.total_rows) / Number(preJoin.distinct_event_ids);
  console.log(`1. Pre-JOIN duplication: ${preRatio.toFixed(2)}x rows per event_id`);
  console.log(`2. Token map uniqueness: ${mapDups.length === 0 ? 'OK' : 'HAS DUPLICATES'}`);
  console.log(`3. Events with both maker+taker: ${bothLegs.cnt}`);
  console.log(`4. Duplicate event_ids: ${dupEvents.length > 0 ? dupEvents.length + ' found' : 'None'}`);
  console.log(`5. Cash flow with/without dedup: ${cashFlowRatio.toFixed(2)}x difference`);

  await clickhouse.close();
}

main().catch(console.error);
