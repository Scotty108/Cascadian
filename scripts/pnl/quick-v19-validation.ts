/**
 * Quick V19 Validation
 * Tests V19 against all UI benchmarks (faster than full comparison)
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import { calculateV19PnL } from '../../lib/pnl/uiActivityEngineV19';

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║   QUICK V19 VALIDATION VS UI BENCHMARKS                        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const client = getClickHouseClient();

  // Get all benchmark wallets
  const query = `
    SELECT
      wallet,
      pnl_value as ui_pnl,
      captured_at
    FROM pm_ui_pnl_benchmarks_v1
    WHERE (wallet, captured_at) IN (
      SELECT wallet, max(captured_at)
      FROM pm_ui_pnl_benchmarks_v1
      GROUP BY wallet
    )
    AND abs(pnl_value) >= 10
    ORDER BY captured_at DESC
    LIMIT 30
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const wallets = await result.json() as any[];

  console.log(`Testing V19 on ${wallets.length} wallets...\n`);
  console.log('Wallet                                      | UI PnL       | V19 PnL      | Delta %');
  console.log('─'.repeat(95));

  let totalAbsDelta = 0;
  let count = 0;
  let within10 = 0;
  let within20 = 0;
  let within50 = 0;

  for (const w of wallets) {
    const start = Date.now();
    try {
      const v19Result = await calculateV19PnL(w.wallet);
      const v19Pnl = v19Result?.total_pnl ?? 0;
      const deltaPct = ((v19Pnl - w.ui_pnl) / Math.abs(w.ui_pnl)) * 100;

      const elapsed = Date.now() - start;
      const sign = deltaPct >= 0 ? '+' : '';
      console.log(
        `${w.wallet} | $${w.ui_pnl.toFixed(2).padStart(10)} | $${v19Pnl.toFixed(2).padStart(10)} | ${sign}${deltaPct.toFixed(1)}% [${elapsed}ms]`
      );

      totalAbsDelta += Math.abs(deltaPct);
      count++;
      if (Math.abs(deltaPct) <= 10) within10++;
      if (Math.abs(deltaPct) <= 20) within20++;
      if (Math.abs(deltaPct) <= 50) within50++;
    } catch (e: any) {
      console.log(`${w.wallet} | $${w.ui_pnl.toFixed(2).padStart(10)} | ERROR: ${e.message.slice(0, 30)}`);
    }
  }

  console.log('\n' + '═'.repeat(95));
  console.log('V19 SUMMARY:');
  console.log('─'.repeat(50));
  console.log(`Wallets tested: ${count}`);
  console.log(`Average absolute delta: ${(totalAbsDelta / count).toFixed(1)}%`);
  console.log(`Within 10% of UI: ${within10}/${count} (${((within10/count)*100).toFixed(0)}%)`);
  console.log(`Within 20% of UI: ${within20}/${count} (${((within20/count)*100).toFixed(0)}%)`);
  console.log(`Within 50% of UI: ${within50}/${count} (${((within50/count)*100).toFixed(0)}%)`);
}

main().catch(console.error);
