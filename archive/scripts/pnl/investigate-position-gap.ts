// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env tsx
/**
 * Investigate the ~150 position gap between Goldsky and V4
 * and the $4.9M loss gap
 *
 * Claude 1 - PnL Calibration
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

const SPORTS_BETTOR = '0xf29bb8e0712075041e87e8605b69833ef738dd4c';

async function main() {
  console.log('==============================================================================');
  console.log('        INVESTIGATE POSITION GAP: Goldsky (547) vs V4 (697)                   ');
  console.log('==============================================================================');

  // 1. Check position identification in each source
  console.log('
=== 1. Position Identification ===');

  // Goldsky uses condition_id
  const gsPositions = await clickhouse.query({
    query: `
      SELECT
        count() as total_positions,
        count(DISTINCT condition_id) as unique_condition_ids,
        count(DISTINCT position_id) as unique_position_ids
      FROM pm_user_positions
      WHERE lower(proxy_wallet) = '${SPORTS_BETTOR}'
    `,
    format: 'JSONEachRow',
  });
  const gs = (await gsPositions.json())[0] as any;
  console.log('Goldsky pm_user_positions:');
  console.log(`  Total positions:        ${gs.total_positions}`);
  console.log(`  Unique condition_ids:   ${gs.unique_condition_ids}`);
  console.log(`  Unique position_ids:    ${gs.unique_position_ids}`);

  // V4 uses wallet + condition_id + outcome_index
  const v4Positions = await clickhouse.query({
    query: `
      SELECT
        count() as total_positions,
        count(DISTINCT condition_id) as unique_condition_ids,
        count(DISTINCT concat(condition_id, '-', toString(outcome_index))) as unique_position_ids
      FROM pm_wallet_market_pnl_v4
      WHERE lower(wallet) = '${SPORTS_BETTOR}'
    `,
    format: 'JSONEachRow',
  });
  const v4 = (await v4Positions.json())[0] as any;
  console.log('
V4 pm_wallet_market_pnl_v4:');
  console.log(`  Total positions:        ${v4.total_positions}`);
  console.log(`  Unique condition_ids:   ${v4.unique_condition_ids}`);
  console.log(`  Unique position_ids:    ${v4.unique_position_ids}`);

  // 2. How many condition_ids have 2+ outcomes in V4?
  console.log('
=== 2. Multi-Outcome Positions (Both YES and NO) ===');
  const multiOutcome = await clickhouse.query({
    query: `
      SELECT
        count() as conditions_with_multi_outcomes,
        sum(outcomes_count) as total_outcomes
      FROM (
        SELECT condition_id, count() as outcomes_count
        FROM pm_wallet_market_pnl_v4
        WHERE lower(wallet) = '${SPORTS_BETTOR}'
        GROUP BY condition_id
        HAVING count() > 1
      )
    `,
    format: 'JSONEachRow',
  });
  const multi = (await multiOutcome.json())[0] as any;
  console.log(`  Conditions with both YES+NO bets: ${multi.conditions_with_multi_outcomes}`);
  console.log(`  Total outcomes from multi-bets:   ${multi.total_outcomes}`);
  console.log(`  Extra positions vs condition:     ${Number(multi.total_outcomes) - Number(multi.conditions_with_multi_outcomes)}`);

  // 3. Goldsky vs V4 condition overlap
  console.log('
=== 3. Condition ID Overlap ===');
  const overlap = await clickhouse.query({
    query: `
      SELECT
        countIf(gs_exists AND v4_exists) as both,
        countIf(gs_exists AND NOT v4_exists) as goldsky_only,
        countIf(NOT gs_exists AND v4_exists) as v4_only
      FROM (
        SELECT
          condition_id,
          max(gs) as gs_exists,
          max(v4) as v4_exists
        FROM (
          SELECT condition_id, 1 as gs, 0 as v4
          FROM pm_user_positions
          WHERE lower(proxy_wallet) = '${SPORTS_BETTOR}'
          UNION ALL
          SELECT condition_id, 0 as gs, 1 as v4
          FROM pm_wallet_market_pnl_v4
          WHERE lower(wallet) = '${SPORTS_BETTOR}'
        )
        GROUP BY condition_id
      )
    `,
    format: 'JSONEachRow',
  });
  const ov = (await overlap.json())[0] as any;
  console.log(`  In both Goldsky AND V4: ${ov.both}`);
  console.log(`  Goldsky only:           ${ov.goldsky_only}`);
  console.log(`  V4 only:                ${ov.v4_only}`);

  // 4. PnL for V4-only positions (may be trades without resolution)
  console.log('
=== 4. PnL for V4-Only Positions ===');
  const v4Only = await clickhouse.query({
    query: `
      WITH goldsky_conditions AS (
        SELECT DISTINCT condition_id
        FROM pm_user_positions
        WHERE lower(proxy_wallet) = '${SPORTS_BETTOR}'
      )
      SELECT
        count() as positions,
        sum(total_pnl) as total_pnl,
        sum(trading_pnl) as trading_pnl,
        sum(resolution_pnl) as resolution_pnl,
        sumIf(total_pnl, total_pnl > 0) as gains,
        sumIf(total_pnl, total_pnl < 0) as losses
      FROM pm_wallet_market_pnl_v4
      WHERE lower(wallet) = '${SPORTS_BETTOR}'
        AND condition_id NOT IN (SELECT condition_id FROM goldsky_conditions)
    `,
    format: 'JSONEachRow',
  });
  const v4o = (await v4Only.json())[0] as any;
  console.log(`  Positions:      ${v4o.positions}`);
  console.log(`  Total PnL:      $${Number(v4o.total_pnl).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Trading PnL:    $${Number(v4o.trading_pnl).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Resolution PnL: $${Number(v4o.resolution_pnl).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Gains:          $${Number(v4o.gains).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Losses:         $${Number(v4o.losses).toLocaleString(undefined, {maximumFractionDigits: 0})}`);

  // 5. Recalculate using Goldsky's condition-level aggregation
  console.log('
=== 5. If We Aggregate V4 at Condition Level (like Goldsky) ===');
  const condLevel = await clickhouse.query({
    query: `
      SELECT
        count() as condition_count,
        sumIf(cond_pnl, cond_pnl > 0) as gains,
        -sumIf(cond_pnl, cond_pnl < 0) as losses,
        sum(cond_pnl) as net_pnl
      FROM (
        SELECT condition_id, sum(total_pnl) as cond_pnl
        FROM pm_wallet_market_pnl_v4
        WHERE lower(wallet) = '${SPORTS_BETTOR}'
        GROUP BY condition_id
      )
    `,
    format: 'JSONEachRow',
  });
  const cond = (await condLevel.json())[0] as any;
  console.log(`  Conditions:     ${cond.condition_count}`);
  console.log(`  Gains:          $${Number(cond.gains).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Losses:         $${Number(cond.losses).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Net PnL:        $${Number(cond.net_pnl).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  UI Target:      Gains=$28,812,489  Losses=$38,833,660  Net=-$10,021,172`);

  // 6. What about partial resolutions? Count resolution events per condition
  console.log('
=== 6. Resolution Events Distribution ===');
  const resEvents = await clickhouse.query({
    query: `
      SELECT
        countIf(res_count = 0) as no_resolution,
        countIf(res_count = 1) as single_resolution,
        countIf(res_count = 2) as dual_resolution,
        countIf(res_count > 2) as many_resolutions
      FROM (
        SELECT condition_id, countIf(event_type = 'RESOLUTION') as res_count
        FROM vw_pm_ledger_test
        WHERE wallet_address = '${SPORTS_BETTOR}'
        GROUP BY condition_id
      )
    `,
    format: 'JSONEachRow',
  });
  const res = (await resEvents.json())[0] as any;
  console.log(`  Conditions with 0 resolutions: ${res.no_resolution}`);
  console.log(`  Conditions with 1 resolution:  ${res.single_resolution}`);
  console.log(`  Conditions with 2 resolutions: ${res.dual_resolution}`);
  console.log(`  Conditions with 3+ resolutions: ${res.many_resolutions}`);

  // 7. The $4.9M gap - detailed breakdown
  console.log('
=== 7. The $4.9M Loss Gap Analysis ===');
  const lossGap = 38833660 - 33927580;
  console.log(`  UI Target Losses:     $38,833,660`);
  console.log(`  Our L1/L4 Losses:     $33,927,580`);
  console.log(`  Gap:                  $${lossGap.toLocaleString()}`);
  console.log('');
  console.log('  Possible explanations:');
  console.log('  1. Fees not captured in our data');
  console.log('  2. Different cost basis accounting (FIFO vs WAC)');
  console.log('  3. Position aggregation differences');
  console.log('  4. Point-in-time snapshot difference');

  await clickhouse.close();
}

main().catch(console.error);
