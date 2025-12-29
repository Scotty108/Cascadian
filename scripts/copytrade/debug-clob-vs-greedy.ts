/**
 * Debug CLOB API vs Greedy optimization discrepancy
 *
 * CLOB API held value: $139.82 (4 winners)
 * Greedy held value: $413.82 (7 winners)
 * Gap: $274
 *
 * Need to understand WHY they differ
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '@/lib/clickhouse/client';
import { ClobClient } from '@polymarket/clob-client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== DEBUG CLOB API vs GREEDY ===\n');

  const client = new ClobClient('https://clob.polymarket.com', 137);

  // Step 1: Get all condition_ids via tx_hash correlation
  const condQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    )
    SELECT DISTINCT condition_id
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
      AND event_type = 'PositionSplit'
      AND is_deleted = 0
  `;
  const r1 = await clickhouse.query({ query: condQ, format: 'JSONEachRow' });
  const conditions = (await r1.json() as any[]).map(c => c.condition_id);
  console.log(`Found ${conditions.length} conditions\n`);

  // Step 2: Get token positions
  const posQ = `
    SELECT
      token_id,
      sum(if(side = 'buy', token_amount, 0)) / 1e6 as bought,
      sum(if(side = 'sell', token_amount, 0)) / 1e6 as sold
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    GROUP BY token_id
  `;
  const r2 = await clickhouse.query({ query: posQ, format: 'JSONEachRow' });
  const positions = await r2.json() as any[];

  const tokenPositions = new Map<string, { bought: number; sold: number; net: number }>();
  for (const p of positions) {
    const bought = parseFloat(p.bought);
    const sold = parseFloat(p.sold);
    tokenPositions.set(p.token_id, { bought, sold, net: bought - sold });
  }

  // Step 3: For each condition, get CLOB market and compare
  console.log('Condition Analysis:');
  console.log('='.repeat(120));
  console.log('Condition ID (first 20)         | Token A Winner | Token A Net | Token B Winner | Token B Net | CLOB Value | DB Resolution');
  console.log('-'.repeat(120));

  let totalClobValue = 0;
  let winnerCount = 0;

  // Get resolution prices from DB
  const resQ = `
    SELECT condition_id, outcome_index, resolved_price
    FROM vw_pm_resolution_prices
    WHERE condition_id IN (${conditions.map(c => `'${c}'`).join(',')})
  `;
  const r3 = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resolutions = await r3.json() as any[];

  const resolutionMap = new Map<string, Map<number, number>>();
  for (const r of resolutions) {
    if (!resolutionMap.has(r.condition_id)) {
      resolutionMap.set(r.condition_id, new Map());
    }
    resolutionMap.get(r.condition_id)!.set(r.outcome_index, parseFloat(r.resolved_price));
  }

  for (const conditionId of conditions.slice(0, 15)) {
    try {
      const market = await client.getMarket(conditionId);
      const tokens = market.tokens || [];

      if (tokens.length === 2) {
        const t0 = tokens[0];
        const t1 = tokens[1];

        const pos0 = tokenPositions.get(t0.token_id);
        const pos1 = tokenPositions.get(t1.token_id);

        const net0 = pos0?.net || 0;
        const net1 = pos1?.net || 0;

        // Calculate CLOB-based value
        const val0 = net0 > 0 && t0.winner ? net0 : 0;
        const val1 = net1 > 0 && t1.winner ? net1 : 0;
        const clobValue = val0 + val1;
        totalClobValue += clobValue;

        if (t0.winner) winnerCount++;
        if (t1.winner) winnerCount++;

        // Get DB resolution
        const dbRes = resolutionMap.get(conditionId);
        const dbResStr = dbRes ? `0:${dbRes.get(0)?.toFixed(1)} 1:${dbRes.get(1)?.toFixed(1)}` : 'N/A';

        console.log(
          `${conditionId.slice(0, 28)}... | ` +
          `${t0.winner ? 'WIN' : 'LOSE'}`.padEnd(14) + ` | ` +
          `${net0.toFixed(2).padStart(10)} | ` +
          `${t1.winner ? 'WIN' : 'LOSE'}`.padEnd(14) + ` | ` +
          `${net1.toFixed(2).padStart(10)} | ` +
          `$${clobValue.toFixed(2).padStart(7)} | ` +
          dbResStr
        );
      }
    } catch (e) {
      console.log(`${conditionId.slice(0, 28)}... | ERROR: ${(e as Error).message.slice(0, 50)}`);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 100));
  }

  console.log('='.repeat(120));
  console.log(`\nTotal CLOB Value (first 15): $${totalClobValue.toFixed(2)}`);
  console.log(`Winner tokens found: ${winnerCount}`);

  // Step 4: Compare with greedy
  console.log('\n=== GREEDY vs CLOB COMPARISON ===');
  console.log('Ground truth P&L: -$86.66');
  console.log('P&L before held: -$500.49');
  console.log('Required held value: $413.83 (to match ground truth)');
  console.log(`CLOB API held value: $${totalClobValue.toFixed(2)}`);
  console.log(`Gap: $${(413.83 - totalClobValue).toFixed(2)}`);

  console.log('\n=== HYPOTHESIS ===');
  console.log('If CLOB API says fewer tokens are winners than what actually happened,');
  console.log('the wallet may have profited from positions that CLOB doesn\'t report as "winner=true".');
  console.log('This could happen if:');
  console.log('  1. CLOB API winner field is stale/not updated');
  console.log('  2. Market was resolved differently than CLOB reports');
  console.log('  3. Redemptions happened via a different mechanism');
}

main().catch(console.error);
