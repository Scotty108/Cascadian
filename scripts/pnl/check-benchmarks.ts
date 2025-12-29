/**
 * Check benchmark wallets from pm_ui_pnl_benchmarks_v1
 */

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  const query = `
    SELECT wallet, username, pnl, volume_traded
    FROM pm_ui_pnl_benchmarks_v1
    WHERE benchmark_set = 'manual_50'
    ORDER BY captured_at DESC
    LIMIT 1 BY wallet
    LIMIT 10
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  console.log('Wallet                                     | Username       | PnL          | Volume');
  console.log('-'.repeat(90));
  for (const r of rows) {
    console.log(
      `${r.wallet} | ${String(r.username).padEnd(14)} | $${Number(r.pnl).toFixed(2).padStart(10)} | $${Number(r.volume_traded).toFixed(2)}`
    );
  }
}

main().catch(console.error);
