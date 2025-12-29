/**
 * Compare PnL engine versions to find which gets closest to UI
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

// Import the engines we want to compare
import { createV13Engine } from '../../lib/pnl/uiActivityEngineV13';
import { createV17Engine } from '../../lib/pnl/uiActivityEngineV17';
import { calculateV19PnL } from '../../lib/pnl/uiActivityEngineV19';
import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';

async function main() {
  const wallet = '0x16ea6d68c8305c1c8f95d247d0845d19c9cf6df7';
  const uiTotal = 2607.79;

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║   ENGINE VERSION COMPARISON                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log('Wallet:', wallet);
  console.log('UI Total PnL: $' + uiTotal.toFixed(2));
  console.log('\n' + '─'.repeat(60) + '\n');

  // Create engine instances
  const v13Engine = createV13Engine();
  const v17Engine = createV17Engine();

  const engines = [
    { name: 'V13', fn: async (w: string) => v13Engine.compute(w) },
    { name: 'V17', fn: async (w: string) => v17Engine.compute(w) },
    { name: 'V19', fn: calculateV19PnL },
    { name: 'V20', fn: calculateV20PnL },
  ];

  const results: { name: string; pnl: number; delta: number; deltaPct: number }[] = [];

  for (const engine of engines) {
    try {
      console.log(`Testing ${engine.name}...`);
      const start = Date.now();
      const result = await engine.fn(wallet);
      const elapsed = Date.now() - start;

      // Handle different result shapes from different engines
      const pnl = result?.total_pnl ?? result?.totalPnl ?? result?.realized_pnl ?? result?.realized ?? result?.total ?? 0;
      const delta = pnl - uiTotal;
      const deltaPct = (delta / Math.abs(uiTotal)) * 100;

      results.push({ name: engine.name, pnl, delta, deltaPct });
      console.log(`  → $${pnl.toFixed(2)} (delta: ${delta >= 0 ? '+' : ''}$${delta.toFixed(2)}, ${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%) [${elapsed}ms]\n`);
    } catch (e: any) {
      console.log(`  → ERROR: ${e.message}\n`);
      results.push({ name: engine.name, pnl: NaN, delta: NaN, deltaPct: NaN });
    }
  }

  // Also add our direct calculation
  const client = getClickHouseClient();
  const directQuery = `
    SELECT
      sumIf(
        cash_flow + final_shares *
        CASE
          WHEN r.payout_numerators LIKE '[0,%' AND m.outcome_index = 0 THEN 0.0
          WHEN r.payout_numerators LIKE '[0,%' AND m.outcome_index = 1 THEN 1.0
          WHEN r.payout_numerators LIKE '[1,%' AND m.outcome_index = 0 THEN 1.0
          WHEN r.payout_numerators LIKE '[1,%' AND m.outcome_index = 1 THEN 0.0
          ELSE 0.0
        END,
        r.payout_numerators IS NOT NULL
      ) as realized
    FROM (
      SELECT
        m.condition_id as cid,
        m.outcome_index,
        sum(CASE WHEN t.side = 'buy' THEN -t.usdc_amount ELSE t.usdc_amount END) / 1000000.0 as cash_flow,
        sum(CASE WHEN t.side = 'buy' THEN t.token_amount ELSE -t.token_amount END) / 1000000.0 as final_shares
      FROM pm_trader_events_dedup_v2_tbl t
      INNER JOIN pm_token_to_condition_map_v4 m
        ON toString(t.token_id) = toString(m.token_id_dec)
      WHERE lower(t.trader_wallet) = lower('${wallet}')
      GROUP BY m.condition_id, m.outcome_index
    ) pos
    LEFT JOIN pm_token_to_condition_map_v4 m ON pos.cid = m.condition_id AND pos.outcome_index = m.outcome_index
    LEFT JOIN pm_condition_resolutions r ON lower(pos.cid) = lower(r.condition_id) AND r.is_deleted = 0
  `;

  try {
    const directResult = await client.query({ query: directQuery, format: 'JSONEachRow' });
    const directRow = (await directResult.json())[0] as any;
    const directPnl = Number(directRow.realized);
    const directDelta = directPnl - uiTotal;
    const directDeltaPct = (directDelta / Math.abs(uiTotal)) * 100;
    results.push({ name: 'Direct (dedup_v2)', pnl: directPnl, delta: directDelta, deltaPct: directDeltaPct });
  } catch (e: any) {
    console.log('Direct calculation error:', e.message);
  }

  // Sort by absolute delta
  results.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));

  console.log('\n' + '═'.repeat(60));
  console.log('RESULTS (sorted by closest to UI):');
  console.log('═'.repeat(60));
  console.log('Rank | Engine          | PnL           | Delta         | Delta %');
  console.log('─'.repeat(60));

  results.forEach((r, i) => {
    const rank = (i + 1).toString().padStart(2);
    const name = r.name.padEnd(15);
    const pnl = isNaN(r.pnl) ? 'ERROR'.padStart(12) : ('$' + r.pnl.toFixed(2)).padStart(12);
    const delta = isNaN(r.delta) ? 'N/A'.padStart(12) : ((r.delta >= 0 ? '+' : '') + '$' + r.delta.toFixed(2)).padStart(12);
    const pct = isNaN(r.deltaPct) ? 'N/A'.padStart(8) : ((r.deltaPct >= 0 ? '+' : '') + r.deltaPct.toFixed(1) + '%').padStart(8);
    console.log(`${rank}   | ${name} | ${pnl} | ${delta} | ${pct}`);
  });

  console.log('\n🎯 WINNER: ' + results[0]?.name + ' with delta of $' + Math.abs(results[0]?.delta || 0).toFixed(2));
}

main().catch(console.error);
