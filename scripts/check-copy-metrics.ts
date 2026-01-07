import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function check() {
  // Check copy trading metrics - top by win_rate with is_copyable = 1
  const sample = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        win_rate,
        realized_pnl,
        resolved_positions,
        is_copyable,
        edge_ratio
      FROM pm_copy_trading_metrics_v1
      WHERE is_copyable = 1
        AND resolved_positions >= 20
        AND win_rate > 0.5
      ORDER BY edge_ratio DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const srows = await sample.json();
  console.log('Top copyable wallets by edge_ratio:');
  for (const row of srows as any[]) {
    const w = row.wallet_address.slice(0,10);
    const wr = (row.win_rate*100).toFixed(1);
    const pnl = row.realized_pnl.toFixed(0);
    console.log(`${w}... | WR: ${wr}% | PnL: $${pnl} | Pos: ${row.resolved_positions} | Edge: ${row.edge_ratio.toFixed(2)}`);
  }

  // Count copyable
  const count = await clickhouse.query({
    query: `SELECT count() as cnt, countIf(is_copyable = 1) as copyable FROM pm_copy_trading_metrics_v1`,
    format: 'JSONEachRow'
  });
  const crows = await count.json();
  const c = crows[0] as any;
  console.log(`\nTotal: ${c.cnt} | Copyable: ${c.copyable}`);
}
check().catch(console.error);
