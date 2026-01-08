/**
 * Debug why PnL calculations differ so much
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  // Test with a specific wallet that had huge difference
  const wallet = '0x7f69983eb28245bba0d5083502a78744a8f66162';

  console.log(`=== DEBUGGING PNL FOR ${wallet} ===\n`);

  // 1. Check precomputed
  console.log('1. Precomputed table (pm_wallet_condition_realized_v1):');
  const precomputed = await clickhouse.query({
    query: `
      SELECT
        sum(realized_pnl) as total_pnl,
        count() as positions,
        sum(is_win) as wins
      FROM pm_wallet_condition_realized_v1
      WHERE wallet = '${wallet}'
    `,
    format: 'JSONEachRow'
  });
  const pre = (await precomputed.json())[0] as any;
  console.log(`  Total PnL: $${pre.total_pnl?.toFixed(2)}`);
  console.log(`  Positions: ${pre.positions}`);
  console.log(`  Wins: ${pre.wins}`);

  // 2. Check raw CLOB events
  console.log('\n2. Raw CLOB events (pm_trader_events_v2):');
  const rawEvents = await clickhouse.query({
    query: `
      SELECT
        count() as total_events,
        uniqExact(event_id) as unique_events,
        sum(usdc_amount) / 1e6 as total_usdc,
        sum(token_amount) / 1e6 as total_tokens
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${wallet}' AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const raw = (await rawEvents.json())[0] as any;
  console.log(`  Total events: ${raw.total_events}`);
  console.log(`  Unique events: ${raw.unique_events}`);
  console.log(`  Total USDC: $${raw.total_usdc?.toFixed(2)}`);
  console.log(`  Total tokens: ${raw.total_tokens?.toFixed(2)}`);

  // Check for duplicates
  const dupRatio = raw.total_events / raw.unique_events;
  console.log(`  Duplicate ratio: ${dupRatio.toFixed(2)}x`);

  // 3. Check by side
  console.log('\n3. By side (deduped):');
  const bySide = await clickhouse.query({
    query: `
      SELECT
        side,
        count() as events,
        sum(usdc) as total_usdc,
        sum(tokens) as total_tokens
      FROM (
        SELECT
          event_id,
          any(lower(side)) as side,
          any(usdc_amount) / 1e6 as usdc,
          any(token_amount) / 1e6 as tokens
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${wallet}' AND is_deleted = 0
        GROUP BY event_id
      )
      GROUP BY side
    `,
    format: 'JSONEachRow'
  });
  const sides = await bySide.json() as any[];
  for (const s of sides) {
    console.log(`  ${s.side}: ${s.events} events, $${s.total_usdc?.toFixed(2)} USDC, ${s.total_tokens?.toFixed(2)} tokens`);
  }

  // 4. Check positions (conditions traded)
  console.log('\n4. Unique conditions traded:');
  const conditions = await clickhouse.query({
    query: `
      SELECT uniqExact(tm.condition_id) as unique_conditions
      FROM (
        SELECT event_id, any(token_id) as token_id
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${wallet}' AND is_deleted = 0
        GROUP BY event_id
      ) t
      INNER JOIN pm_token_to_condition_map_v5 tm ON t.token_id = tm.token_id_dec
    `,
    format: 'JSONEachRow'
  });
  const conds = (await conditions.json())[0] as any;
  console.log(`  Unique conditions: ${conds.unique_conditions}`);

  // 5. Check how many are resolved
  console.log('\n5. Resolved conditions:');
  const resolved = await clickhouse.query({
    query: `
      SELECT count() as resolved_conditions
      FROM (
        SELECT DISTINCT tm.condition_id
        FROM (
          SELECT event_id, any(token_id) as token_id
          FROM pm_trader_events_v2
          WHERE trader_wallet = '${wallet}' AND is_deleted = 0
          GROUP BY event_id
        ) t
        INNER JOIN pm_token_to_condition_map_v5 tm ON t.token_id = tm.token_id_dec
      ) c
      INNER JOIN (
        SELECT condition_id
        FROM pm_condition_resolutions FINAL
        WHERE is_deleted = 0 AND payout_denominator != '' AND payout_denominator != '0'
      ) r ON c.condition_id = r.condition_id
    `,
    format: 'JSONEachRow'
  });
  const res = (await resolved.json())[0] as any;
  console.log(`  Resolved: ${res.resolved_conditions}`);

  // 6. Sample some positions with PnL breakdown
  console.log('\n6. Sample positions (first 10):');
  const positions = await clickhouse.query({
    query: `
      SELECT
        cond,
        cost_basis,
        sell_proceeds,
        net_tokens,
        payout,
        pnl
      FROM (
        SELECT
          e.cond as cond,
          sum(if(e.side = 'buy', e.usdc, 0)) as cost_basis,
          sum(if(e.side = 'sell', e.usdc, 0)) as sell_proceeds,
          sum(if(e.side = 'buy', e.tokens, -e.tokens)) as net_tokens,
          any(e.payout) as payout,
          sum(if(e.side = 'sell', e.usdc, 0)) +
            (greatest(0, sum(if(e.side = 'buy', e.tokens, -e.tokens))) * any(e.payout)) -
            sum(if(e.side = 'buy', e.usdc, 0)) as pnl
        FROM (
          SELECT
            tm.condition_id as cond,
            t.side as side,
            t.usdc as usdc,
            t.tokens as tokens,
            toFloat64(arrayElement(
              JSONExtract(r.payout_numerators, 'Array(UInt64)'),
              toUInt32(tm.outcome_index + 1)
            )) / toFloat64(r.payout_denominator) as payout
          FROM (
            SELECT
              event_id,
              any(token_id) as token_id,
              any(lower(side)) as side,
              any(usdc_amount) / 1e6 as usdc,
              any(token_amount) / 1e6 as tokens
            FROM pm_trader_events_v2
            WHERE trader_wallet = '${wallet}' AND is_deleted = 0
            GROUP BY event_id
          ) t
          INNER JOIN pm_token_to_condition_map_v5 tm ON t.token_id = tm.token_id_dec
          INNER JOIN (
            SELECT condition_id, payout_numerators, payout_denominator
            FROM pm_condition_resolutions FINAL
            WHERE is_deleted = 0 AND payout_denominator != '' AND payout_denominator != '0'
          ) r ON tm.condition_id = r.condition_id
        ) e
        GROUP BY e.cond
      )
      ORDER BY abs(pnl) DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const pos = await positions.json() as any[];
  console.log('  Cond (first 12)'.padEnd(16) + 'Cost'.padStart(12) + 'Sells'.padStart(12) + 'NetTok'.padStart(12) + 'Payout'.padStart(8) + 'PnL'.padStart(14));
  console.log('  ' + '='.repeat(74));

  for (const p of pos) {
    console.log(
      '  ' + p.cond?.substring(0, 12).padEnd(16) +
      `$${p.cost_basis?.toFixed(0)}`.padStart(12) +
      `$${p.sell_proceeds?.toFixed(0)}`.padStart(12) +
      p.net_tokens?.toFixed(0).padStart(12) +
      p.payout?.toFixed(2).padStart(8) +
      `$${p.pnl?.toFixed(0)}`.padStart(14)
    );
  }

  // 7. Sum total PnL
  console.log('\n7. Total CLOB-calculated PnL:');
  const totalPnl = await clickhouse.query({
    query: `
      SELECT
        sum(pnl) as total_pnl,
        count() as positions,
        sumIf(1, pnl > 0) as wins,
        sumIf(1, pnl <= 0) as losses
      FROM (
        SELECT
          e.cond as cond,
          sum(if(e.side = 'sell', e.usdc, 0)) +
            (greatest(0, sum(if(e.side = 'buy', e.tokens, -e.tokens))) * any(e.payout)) -
            sum(if(e.side = 'buy', e.usdc, 0)) as pnl
        FROM (
          SELECT
            tm.condition_id as cond,
            t.side as side,
            t.usdc as usdc,
            t.tokens as tokens,
            toFloat64(arrayElement(
              JSONExtract(r.payout_numerators, 'Array(UInt64)'),
              toUInt32(tm.outcome_index + 1)
            )) / toFloat64(r.payout_denominator) as payout
          FROM (
            SELECT
              event_id,
              any(token_id) as token_id,
              any(lower(side)) as side,
              any(usdc_amount) / 1e6 as usdc,
              any(token_amount) / 1e6 as tokens
            FROM pm_trader_events_v2
            WHERE trader_wallet = '${wallet}' AND is_deleted = 0
            GROUP BY event_id
          ) t
          INNER JOIN pm_token_to_condition_map_v5 tm ON t.token_id = tm.token_id_dec
          INNER JOIN (
            SELECT condition_id, payout_numerators, payout_denominator
            FROM pm_condition_resolutions FINAL
            WHERE is_deleted = 0 AND payout_denominator != '' AND payout_denominator != '0'
          ) r ON tm.condition_id = r.condition_id
        ) e
        GROUP BY e.cond
      )
    `,
    format: 'JSONEachRow'
  });

  const total = (await totalPnl.json())[0] as any;
  console.log(`  CLOB PnL: $${total.total_pnl?.toFixed(2)}`);
  console.log(`  Positions: ${total.positions}`);
  console.log(`  Wins: ${total.wins} | Losses: ${total.losses}`);

  console.log('\n\n=== COMPARISON ===');
  console.log(`  Precomputed: $${pre.total_pnl?.toFixed(2)} (${pre.positions} positions)`);
  console.log(`  CLOB calc:   $${total.total_pnl?.toFixed(2)} (${total.positions} positions)`);
  console.log(`  Difference:  $${(total.total_pnl - pre.total_pnl)?.toFixed(2)}`);
}

main().catch(console.error);
