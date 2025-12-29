/**
 * DEEP-DIVE GAP WALLETS DIAGNOSTIC
 *
 * Purpose: Investigate wallets with 10-20% delta vs UI despite 0% unresolved.
 * These are the KEY diagnostic cases that could push us from 70% → 80%+.
 *
 * Key targets (from plan):
 * - 0x5c8b9b70: UI $9,539 vs V12 $8,068 (15.4% delta, 0% unresolved)
 * - 0xb91115b2: UI -$8,423 vs V12 -$9,575 (13.7% delta, 0% unresolved) [if in dataset]
 *
 * Terminal: 2
 * Date: 2025-12-09
 */

import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 300000,
});

interface GapWallet {
  wallet: string;
  ui_pnl: number;
  v12_pnl: number;
  delta_pct: number;
  unresolved_pct: number;
}

// Key wallets from the validation failures with 10-20% delta
const GAP_WALLETS: GapWallet[] = [
  { wallet: '0x5c8b9b702d4cc07cfa55bb9661064b4899bf3793', ui_pnl: 9539.15, v12_pnl: 8068.11, delta_pct: 15.4, unresolved_pct: 0 },
];

async function analyzeWallet(wallet: string, ui_pnl: number) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`DEEP-DIVE: ${wallet}`);
  console.log(`UI PnL: $${ui_pnl.toLocaleString()}`);
  console.log(`${'='.repeat(80)}`);

  // 1. Basic V12 calculation verification
  console.log('\n--- V12 Basic Calculation ---');
  const v12Query = `
    SELECT
      sum(
        CASE
          WHEN res.payout_numerators IS NOT NULL
               AND res.payout_numerators != ''
               AND map.outcome_index IS NOT NULL THEN
            usdc_delta + (token_delta *
              if(JSONExtractInt(res.payout_numerators, map.outcome_index + 1) >= 1000, 1.0,
                 toFloat64(JSONExtractInt(res.payout_numerators, map.outcome_index + 1)))
            )
          ELSE 0
        END
      ) as realized_pnl,
      count() as event_count,
      countIf(res.payout_numerators IS NOT NULL AND res.payout_numerators != '' AND map.outcome_index IS NOT NULL) as resolved_events,
      countIf(res.payout_numerators IS NULL OR res.payout_numerators = '' OR map.outcome_index IS NULL) as unresolved_events,
      countIf(role = 'maker') as maker_events,
      countIf(role = 'taker') as taker_events
    FROM (
      SELECT
        event_id,
        argMax(token_id, trade_time) as token_id,
        argMax(if(side = 'buy', -usdc_amount, usdc_amount), trade_time) / 1000000.0 as usdc_delta,
        argMax(if(side = 'buy', token_amount, -token_amount), trade_time) / 1000000.0 as token_delta,
        argMax(role, trade_time) as role
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String} AND is_deleted = 0
      GROUP BY event_id
    ) AS te
    LEFT JOIN pm_token_to_condition_map_v5 AS map ON te.token_id = map.token_id_dec
    LEFT JOIN pm_condition_resolutions AS res ON map.condition_id = res.condition_id
    WHERE role = 'maker'
  `;

  const v12Result = await ch.query({ query: v12Query, query_params: { wallet }, format: 'JSONEachRow' });
  const v12Row = (await v12Result.json<any[]>())[0];
  console.log(`V12 Realized PnL: $${Number(v12Row.realized_pnl).toLocaleString()}`);
  console.log(`Event Count: ${v12Row.event_count} (maker: ${v12Row.maker_events}, taker: ${v12Row.taker_events})`);
  console.log(`Resolved: ${v12Row.resolved_events}, Unresolved: ${v12Row.unresolved_events}`);

  // 2. Check if taker events are significant
  console.log('\n--- Maker vs Taker Breakdown ---');
  const makerTakerQuery = `
    SELECT
      role,
      count() as event_count,
      sum(
        CASE
          WHEN res.payout_numerators IS NOT NULL
               AND res.payout_numerators != ''
               AND map.outcome_index IS NOT NULL THEN
            usdc_delta + (token_delta *
              if(JSONExtractInt(res.payout_numerators, map.outcome_index + 1) >= 1000, 1.0,
                 toFloat64(JSONExtractInt(res.payout_numerators, map.outcome_index + 1)))
            )
          ELSE 0
        END
      ) as realized_pnl
    FROM (
      SELECT
        event_id,
        argMax(token_id, trade_time) as token_id,
        argMax(if(side = 'buy', -usdc_amount, usdc_amount), trade_time) / 1000000.0 as usdc_delta,
        argMax(if(side = 'buy', token_amount, -token_amount), trade_time) / 1000000.0 as token_delta,
        argMax(role, trade_time) as role
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String} AND is_deleted = 0
      GROUP BY event_id
    ) AS te
    LEFT JOIN pm_token_to_condition_map_v5 AS map ON te.token_id = map.token_id_dec
    LEFT JOIN pm_condition_resolutions AS res ON map.condition_id = res.condition_id
    GROUP BY role
  `;

  const mtResult = await ch.query({ query: makerTakerQuery, query_params: { wallet }, format: 'JSONEachRow' });
  const mtRows = await mtResult.json<any[]>();
  for (const row of mtRows) {
    console.log(`  ${row.role}: ${row.event_count} events → $${Number(row.realized_pnl).toLocaleString()} PnL`);
  }

  // Calculate combined PnL
  const combinedPnl = mtRows.reduce((sum, row) => sum + Number(row.realized_pnl), 0);
  console.log(`\nCombined (maker+taker) PnL: $${combinedPnl.toLocaleString()}`);
  console.log(`Gap from UI ($${ui_pnl.toLocaleString()}): $${(ui_pnl - combinedPnl).toLocaleString()} (${(Math.abs(ui_pnl - combinedPnl) / Math.abs(ui_pnl) * 100).toFixed(1)}%)`);

  // 3. Check for unmapped tokens
  console.log('\n--- Unmapped Token Check ---');
  const unmappedQuery = `
    SELECT
      count() as unmapped_count,
      sum(abs(usdc_delta)) as unmapped_usdc
    FROM (
      SELECT
        event_id,
        argMax(token_id, trade_time) as token_id,
        argMax(if(side = 'buy', -usdc_amount, usdc_amount), trade_time) / 1000000.0 as usdc_delta
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String} AND is_deleted = 0
      GROUP BY event_id
    ) AS te
    LEFT JOIN pm_token_to_condition_map_v5 AS map ON te.token_id = map.token_id_dec
    WHERE map.condition_id IS NULL
  `;

  const unmappedResult = await ch.query({ query: unmappedQuery, query_params: { wallet }, format: 'JSONEachRow' });
  const unmappedRow = (await unmappedResult.json<any[]>())[0];
  console.log(`Unmapped events: ${unmappedRow.unmapped_count}`);
  console.log(`Unmapped USDC exposure: $${Number(unmappedRow.unmapped_usdc || 0).toLocaleString()}`);

  // 4. Check for position-level summary (top markets)
  console.log('\n--- Top Markets by PnL Impact ---');
  const topMarketsQuery = `
    SELECT
      map.condition_id,
      anyLast(res.payout_numerators) as payout_numerators,
      count() as event_count,
      sum(usdc_delta) as total_usdc_delta,
      sum(token_delta) as total_token_delta,
      sum(
        CASE
          WHEN res.payout_numerators IS NOT NULL
               AND res.payout_numerators != ''
               AND map.outcome_index IS NOT NULL THEN
            usdc_delta + (token_delta *
              if(JSONExtractInt(res.payout_numerators, map.outcome_index + 1) >= 1000, 1.0,
                 toFloat64(JSONExtractInt(res.payout_numerators, map.outcome_index + 1)))
            )
          ELSE 0
        END
      ) as realized_pnl
    FROM (
      SELECT
        event_id,
        argMax(token_id, trade_time) as token_id,
        argMax(if(side = 'buy', -usdc_amount, usdc_amount), trade_time) / 1000000.0 as usdc_delta,
        argMax(if(side = 'buy', token_amount, -token_amount), trade_time) / 1000000.0 as token_delta,
        argMax(role, trade_time) as role
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String} AND is_deleted = 0
      GROUP BY event_id
    ) AS te
    LEFT JOIN pm_token_to_condition_map_v5 AS map ON te.token_id = map.token_id_dec
    LEFT JOIN pm_condition_resolutions AS res ON map.condition_id = res.condition_id
    WHERE role = 'maker'
    GROUP BY map.condition_id
    ORDER BY abs(realized_pnl) DESC
    LIMIT 10
  `;

  const topResult = await ch.query({ query: topMarketsQuery, query_params: { wallet }, format: 'JSONEachRow' });
  const topRows = await topResult.json<any[]>();
  console.log('Rank | Condition ID (first 16 chars) | Events | USDC Flow | Token Flow | PnL');
  for (let i = 0; i < topRows.length; i++) {
    const row = topRows[i];
    const conditionShort = row.condition_id ? row.condition_id.substring(0, 16) + '...' : 'NULL';
    console.log(`${(i+1).toString().padStart(4)} | ${conditionShort.padEnd(22)} | ${row.event_count.toString().padStart(6)} | $${Number(row.total_usdc_delta).toFixed(2).padStart(10)} | ${Number(row.total_token_delta).toFixed(2).padStart(10)} | $${Number(row.realized_pnl).toFixed(2).padStart(10)}`);
  }

  // 5. Check for potential duplicate event IDs (should be 0 with GROUP BY)
  console.log('\n--- Data Quality: Event ID Uniqueness ---');
  const dupCheckQuery = `
    SELECT
      count() as raw_events,
      countDistinct(event_id) as unique_events,
      count() - countDistinct(event_id) as duplicates
    FROM pm_trader_events_v2
    WHERE trader_wallet = {wallet:String} AND is_deleted = 0
  `;

  const dupResult = await ch.query({ query: dupCheckQuery, query_params: { wallet }, format: 'JSONEachRow' });
  const dupRow = (await dupResult.json<any[]>())[0];
  console.log(`Raw events: ${dupRow.raw_events}, Unique event_ids: ${dupRow.unique_events}, Duplicates: ${dupRow.duplicates}`);

  // 6. Check for any events with unusual payout_numerators
  console.log('\n--- Payout Numerator Distribution ---');
  const payoutQuery = `
    SELECT
      res.payout_numerators as payout,
      count() as event_count,
      sum(
        CASE
          WHEN res.payout_numerators IS NOT NULL
               AND res.payout_numerators != ''
               AND map.outcome_index IS NOT NULL THEN
            usdc_delta + (token_delta *
              if(JSONExtractInt(res.payout_numerators, map.outcome_index + 1) >= 1000, 1.0,
                 toFloat64(JSONExtractInt(res.payout_numerators, map.outcome_index + 1)))
            )
          ELSE 0
        END
      ) as realized_pnl
    FROM (
      SELECT
        event_id,
        argMax(token_id, trade_time) as token_id,
        argMax(if(side = 'buy', -usdc_amount, usdc_amount), trade_time) / 1000000.0 as usdc_delta,
        argMax(if(side = 'buy', token_amount, -token_amount), trade_time) / 1000000.0 as token_delta,
        argMax(role, trade_time) as role
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String} AND is_deleted = 0
      GROUP BY event_id
    ) AS te
    LEFT JOIN pm_token_to_condition_map_v5 AS map ON te.token_id = map.token_id_dec
    LEFT JOIN pm_condition_resolutions AS res ON map.condition_id = res.condition_id
    WHERE role = 'maker'
    GROUP BY res.payout_numerators
    ORDER BY event_count DESC
    LIMIT 10
  `;

  const payoutResult = await ch.query({ query: payoutQuery, query_params: { wallet }, format: 'JSONEachRow' });
  const payoutRows = await payoutResult.json<any[]>();
  console.log('Payout Pattern | Events | PnL');
  for (const row of payoutRows) {
    const payoutStr = row.payout || 'NULL/EMPTY';
    console.log(`${payoutStr.padEnd(20)} | ${row.event_count.toString().padStart(6)} | $${Number(row.realized_pnl).toFixed(2).padStart(12)}`);
  }

  // 7. Check outcome_index distribution
  console.log('\n--- Outcome Index Distribution ---');
  const outcomeQuery = `
    SELECT
      map.outcome_index,
      count() as event_count,
      sum(usdc_delta) as usdc_flow,
      sum(token_delta) as token_flow
    FROM (
      SELECT
        event_id,
        argMax(token_id, trade_time) as token_id,
        argMax(if(side = 'buy', -usdc_amount, usdc_amount), trade_time) / 1000000.0 as usdc_delta,
        argMax(if(side = 'buy', token_amount, -token_amount), trade_time) / 1000000.0 as token_delta,
        argMax(role, trade_time) as role
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String} AND is_deleted = 0
      GROUP BY event_id
    ) AS te
    LEFT JOIN pm_token_to_condition_map_v5 AS map ON te.token_id = map.token_id_dec
    WHERE role = 'maker'
    GROUP BY map.outcome_index
    ORDER BY outcome_index
  `;

  const outcomeResult = await ch.query({ query: outcomeQuery, query_params: { wallet }, format: 'JSONEachRow' });
  const outcomeRows = await outcomeResult.json<any[]>();
  console.log('Outcome Index | Events | USDC Flow | Token Flow');
  for (const row of outcomeRows) {
    console.log(`${(row.outcome_index ?? 'NULL').toString().padStart(13)} | ${row.event_count.toString().padStart(6)} | $${Number(row.usdc_flow).toFixed(2).padStart(12)} | ${Number(row.token_flow).toFixed(2).padStart(12)}`);
  }

  // 8. Check for potential fee/spread impact (calculate raw cashflow)
  console.log('\n--- Raw Cash Flow (No Resolution Adjustment) ---');
  const rawCashQuery = `
    SELECT
      sum(usdc_delta) as total_usdc_delta,
      sum(token_delta) as total_token_delta
    FROM (
      SELECT
        event_id,
        argMax(if(side = 'buy', -usdc_amount, usdc_amount), trade_time) / 1000000.0 as usdc_delta,
        argMax(if(side = 'buy', token_amount, -token_amount), trade_time) / 1000000.0 as token_delta,
        argMax(role, trade_time) as role
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String} AND is_deleted = 0
      GROUP BY event_id
    )
    WHERE role = 'maker'
  `;

  const rawResult = await ch.query({ query: rawCashQuery, query_params: { wallet }, format: 'JSONEachRow' });
  const rawRow = (await rawResult.json<any[]>())[0];
  console.log(`Total USDC Delta (maker): $${Number(rawRow.total_usdc_delta).toLocaleString()}`);
  console.log(`Total Token Delta (maker): ${Number(rawRow.total_token_delta).toLocaleString()}`);

  // Gap calculation
  const gap = ui_pnl - Number(v12Row.realized_pnl);
  console.log(`\n${'='.repeat(80)}`);
  console.log(`SUMMARY: Gap = $${gap.toFixed(2)} (${(Math.abs(gap) / Math.abs(ui_pnl) * 100).toFixed(1)}%)`);
  console.log(`${'='.repeat(80)}`);

  return {
    wallet,
    ui_pnl,
    v12_pnl: Number(v12Row.realized_pnl),
    gap,
    combined_pnl: combinedPnl,
    unmapped_count: Number(unmappedRow.unmapped_count || 0),
    duplicates: Number(dupRow.duplicates || 0),
  };
}

async function main() {
  console.log('DEEP-DIVE GAP WALLETS DIAGNOSTIC');
  console.log('='.repeat(80));
  console.log('Target: Wallets with 10-20% delta vs UI despite 0% unresolved');
  console.log('Goal: Understand root cause to push from 70% → 80%+ pass rate');
  console.log('');

  const results: any[] = [];

  for (const target of GAP_WALLETS) {
    try {
      const result = await analyzeWallet(target.wallet, target.ui_pnl);
      results.push(result);
    } catch (error) {
      console.error(`Error analyzing ${target.wallet}:`, error);
    }
  }

  // Write summary
  console.log('\n\n' + '='.repeat(80));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(80));
  for (const r of results) {
    console.log(`${r.wallet.substring(0, 10)}...: UI $${r.ui_pnl.toLocaleString()} | V12 $${r.v12_pnl.toLocaleString()} | Gap $${r.gap.toFixed(2)} | Combined $${r.combined_pnl.toLocaleString()}`);
  }

  await ch.close();
}

main().catch(console.error);
