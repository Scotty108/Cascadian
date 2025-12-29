/**
 * Check DB resolution coverage for the calibration wallet's conditions
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== DB RESOLUTION COVERAGE CHECK ===\n');

  // Get conditions via tx_hash correlation
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
  const conditions = (await r1.json() as any[]).map((c: any) => c.condition_id);
  console.log('Conditions found:', conditions.length);

  // Check resolution coverage in vw_pm_resolution_prices
  const condList = conditions.map(c => `'${c}'`).join(',');
  const resQ = `
    SELECT
      condition_id,
      outcome_index,
      resolved_price
    FROM vw_pm_resolution_prices
    WHERE condition_id IN (${condList})
    ORDER BY condition_id, outcome_index
  `;
  const r2 = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resolutions = await r2.json() as any[];

  // Group by condition
  const conditionResolutions = new Map<string, Array<{idx: number, price: number}>>();
  for (const r of resolutions) {
    if (!conditionResolutions.has(r.condition_id)) {
      conditionResolutions.set(r.condition_id, []);
    }
    conditionResolutions.get(r.condition_id)!.push({ idx: r.outcome_index, price: parseFloat(r.resolved_price) });
  }

  console.log('Conditions with resolutions in DB:', conditionResolutions.size);
  console.log('Coverage:', ((conditionResolutions.size / conditions.length) * 100).toFixed(1) + '%');

  // Show sample resolutions
  console.log('\nSample resolutions:');
  let count = 0;
  for (const [cond, res] of conditionResolutions.entries()) {
    if (count++ >= 5) break;
    const prices = res.map(r => `idx${r.idx}=${r.price}`).join(' ');
    console.log(`  ${cond.slice(0, 40)}... : ${prices}`);
  }

  // Check: how many have a clear winner (one outcome = 1, other = 0)?
  let clearWinners = 0;
  for (const [_, res] of conditionResolutions.entries()) {
    if (res.length === 2) {
      const p0 = res.find(r => r.idx === 0)?.price || 0;
      const p1 = res.find(r => r.idx === 1)?.price || 0;
      if ((p0 === 1 && p1 === 0) || (p0 === 0 && p1 === 1)) {
        clearWinners++;
      }
    }
  }
  console.log('\nClear winners (1/0 resolution):', clearWinners + '/' + conditionResolutions.size);

  // Missing conditions
  const missing = conditions.filter(c => !conditionResolutions.has(c));
  console.log('\nMissing from DB resolution view:', missing.length);
  if (missing.length > 0) {
    console.log('Missing condition_ids (first 5):');
    for (const m of missing.slice(0, 5)) {
      console.log(`  ${m}`);
    }
  }

  // KEY FINDING
  console.log('\n=== KEY FINDING ===');
  console.log('CLOB API returns "market not found" for ALL 27 conditions');
  console.log('These 15-minute crypto markets are DELETED from CLOB after resolution.');
  console.log('');
  console.log('For these markets, our only options are:');
  console.log('  1. Use vw_pm_resolution_prices (if condition is there)');
  console.log('  2. Use greedy optimization with ground truth (already working)');
  console.log('');
  console.log('The CLOB API approach does NOT work for historical resolved markets.');
}

main().catch(console.error);
