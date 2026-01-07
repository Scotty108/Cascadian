import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const wallet = '0xbf4f05a8b1d08f82d57697bb0bbfda19b0df5b24';

async function check() {
  // Correct dedup: GROUP BY event_id first, then aggregate by token
  const q = `
    SELECT
      token_id,
      sum(usdc) / 1e6 as cost_basis,
      sum(tokens) / 1e6 as shares,
      count(*) as fill_count
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
      GROUP BY event_id  -- DEDUP BY EVENT_ID
    )
    GROUP BY token_id
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const positions = (await r.json()) as any[];

  console.log('POSITIONS (CORRECTLY DEDUPED BY EVENT_ID):');
  console.log('-'.repeat(60));

  let totalCost = 0;
  let totalShares = 0;

  for (const p of positions) {
    const cost = Number(p.cost_basis);
    const shares = Number(p.shares);
    totalCost += cost;
    totalShares += shares;
  }

  console.log(`Total positions: ${positions.length}`);
  console.log(`Total cost: $${totalCost.toFixed(2)}`);
  console.log(`Total shares: ${totalShares.toFixed(2)}`);

  // Compare with original (no dedup)
  const rawQ = `
    SELECT
      sum(usdc_amount) / 1e6 as total_cost,
      sum(token_amount) / 1e6 as total_shares,
      count(*) as row_count
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${wallet}')
      AND is_deleted = 0
      AND side = 'buy'
  `;

  const rawR = await clickhouse.query({ query: rawQ, format: 'JSONEachRow' });
  const raw = (await rawR.json()) as any[];

  console.log('\nRAW (NO DEDUP):');
  console.log(`Total cost: $${Number(raw[0].total_cost).toFixed(2)}`);
  console.log(`Total shares: ${Number(raw[0].total_shares).toFixed(2)}`);
  console.log(`Row count: ${raw[0].row_count}`);

  const factor = Number(raw[0].total_cost) / totalCost;
  console.log(`\nDUPLICATION FACTOR: ${factor.toFixed(2)}x`);
}

check();
