/**
 * Check for duplicates in dedup table and calculate corrected PnL
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0x8e59b4fb3003c9ab2d529e36ef02a5e070fcad53';

async function main() {
  console.log('=== Checking for duplicates in dedup table ===\n');

  const dupes = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        uniqExact(event_id) as unique_events,
        count() - uniqExact(event_id) as duplicates
      FROM pm_trader_events_dedup_v2_tbl
      WHERE trader_wallet = '${WALLET}'
    `,
    format: 'JSONEachRow'
  });
  const d = (await dupes.json() as any[])[0];
  console.log('Total rows: ' + d.total_rows);
  console.log('Unique events: ' + d.unique_events);
  console.log('Duplicates: ' + d.duplicates);

  if (Number(d.duplicates) > 0) {
    console.log('\n=== Duplicate events ===');
    const dupList = await clickhouse.query({
      query: `
        SELECT event_id, count() as cnt
        FROM pm_trader_events_dedup_v2_tbl
        WHERE trader_wallet = '${WALLET}'
        GROUP BY event_id
        HAVING cnt > 1
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const dl = await dupList.json() as any[];
    for (const row of dl) {
      console.log('  event=' + row.event_id.slice(0,30) + '... count=' + row.cnt);
    }
  }

  // Calculate correct PnL with deduplication
  console.log('\n=== Corrected PnL with GROUP BY event_id ===');
  const corrected = await clickhouse.query({
    query: `
      SELECT
        m.condition_id,
        m.outcome_index,
        sumIf(e.token_amount, e.side = 'buy') / 1e6 AS buy_tokens,
        sumIf(e.token_amount, e.side = 'sell') / 1e6 AS sell_tokens,
        sumIf(e.usdc_amount, e.side = 'buy') / 1e6 AS buy_usdc,
        sumIf(e.usdc_amount, e.side = 'sell') / 1e6 AS sell_usdc
      FROM (
        SELECT
          event_id,
          any(side) as side,
          any(token_id) as token_id,
          any(token_amount) as token_amount,
          any(usdc_amount) as usdc_amount
        FROM pm_trader_events_dedup_v2_tbl
        WHERE trader_wallet = '${WALLET}'
        GROUP BY event_id
      ) e
      INNER JOIN pm_token_to_condition_map_v5 m ON m.token_id_dec = e.token_id
      GROUP BY m.condition_id, m.outcome_index
    `,
    format: 'JSONEachRow'
  });
  const corrPos = await corrected.json() as any[];

  let corrTotal = 0;
  for (const p of corrPos) {
    const buyT = Number(p.buy_tokens);
    const sellT = Number(p.sell_tokens);
    const buyU = Number(p.buy_usdc);
    const sellU = Number(p.sell_usdc);
    const finalTokens = buyT - sellT;
    const netCash = sellU - buyU;

    // Get resolution
    const res = await clickhouse.query({
      query: `SELECT resolved_price FROM vw_pm_resolution_prices WHERE condition_id = '${p.condition_id}' AND outcome_index = ${p.outcome_index}`,
      format: 'JSONEachRow'
    });
    const resRow = (await res.json() as any[])[0];
    const resPrice = resRow ? Number(resRow.resolved_price) : null;

    const pnl = resPrice !== null ? netCash + finalTokens * resPrice : null;
    if (pnl !== null) corrTotal += pnl;

    console.log('cond=' + p.condition_id.slice(0,15) + '... out=' + p.outcome_index);
    console.log('  final_tokens=' + finalTokens.toFixed(0) + ' net_cash=$' + netCash.toFixed(0) + ' res=' + resPrice + ' pnl=$' + (pnl ? pnl.toFixed(0) : 'N/A'));
  }

  console.log('\nCorrected SQL Total: $' + corrTotal.toFixed(0));
  console.log('V11 Realized: $190,443');
  console.log('Original SQL: $373,601');
}

main().catch(console.error);
