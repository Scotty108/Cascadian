import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const wallet = '0xbf4f05a8b1d08f82d57697bb0bbfda19b0df5b24';

async function check() {
  // Get all positions with CORRECT dedup by event_id
  const q = `
    SELECT
      token_id,
      sum(usdc) / 1e6 as cost_basis,
      sum(tokens) / 1e6 as shares
    FROM (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(usdc_amount) as usdc,
        any(token_amount) as tokens
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
        AND side = 'buy'
      GROUP BY event_id
    )
    GROUP BY token_id
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const positions = (await r.json()) as any[];

  let totalPnl = 0;
  let wonCount = 0,
    lostCount = 0,
    unresolvedCount = 0;
  let wonProfit = 0,
    lostCost = 0;

  console.log('CALCULATING PNL WITH CORRECT DEDUP:');
  console.log('-'.repeat(70));

  for (const p of positions) {
    const cost = Number(p.cost_basis);
    const shares = Number(p.shares);

    // Get condition mapping
    const mapQ = `
      SELECT condition_id, outcome_index
      FROM pm_token_to_condition_map_v5
      WHERE token_id_dec = '${p.token_id}'
    `;

    const mapR = await clickhouse.query({ query: mapQ, format: 'JSONEachRow' });
    const mapRows = (await mapR.json()) as any[];

    if (mapRows.length === 0) {
      console.log(`Token ${p.token_id.slice(0, 12)}...: NO MAPPING (${shares.toFixed(2)} shares, $${cost.toFixed(2)})`);
      unresolvedCount++;
      continue;
    }

    const m = mapRows[0];

    // Get resolution
    const resQ = `
      SELECT payout_numerators
      FROM pm_condition_resolutions
      WHERE condition_id = '${m.condition_id}'
    `;

    const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
    const resRows = (await resR.json()) as any[];

    if (resRows.length === 0) {
      console.log(`Token ${p.token_id.slice(0, 12)}...: UNRESOLVED (${shares.toFixed(2)} shares)`);
      unresolvedCount++;
      continue;
    }

    const payouts = JSON.parse(resRows[0].payout_numerators.replace(/'/g, '"'));
    const payout = payouts[m.outcome_index] > 0 ? 1.0 : 0.0;

    const pnl = payout * shares - cost;
    totalPnl += pnl;

    if (payout > 0) {
      wonCount++;
      wonProfit += pnl;
      console.log(`✓ WON: ${shares.toFixed(2)} @ $${(cost / shares).toFixed(4)} → pnl: +$${pnl.toFixed(2)}`);
    } else {
      lostCount++;
      lostCost += cost;
      console.log(`✗ LOST: ${shares.toFixed(2)} @ $${(cost / shares).toFixed(4)} → pnl: -$${cost.toFixed(2)}`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY:');
  console.log(`Won: ${wonCount} positions → +$${wonProfit.toFixed(2)}`);
  console.log(`Lost: ${lostCount} positions → -$${lostCost.toFixed(2)}`);
  console.log(`Unresolved/No mapping: ${unresolvedCount}`);
  console.log('');
  console.log(`TOTAL PNL: $${totalPnl.toFixed(2)}`);
  console.log(`UI SHOWS:  $123.05`);
  console.log(`GAP:       $${(123.05 - totalPnl).toFixed(2)}`);
}

check();
