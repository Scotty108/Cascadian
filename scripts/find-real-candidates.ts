import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function find() {
  // Find wallets with realistic win rates (60-80%) - not arbers
  const query = `
    SELECT
      wallet_address,
      win_rate,
      realized_pnl,
      resolved_positions,
      is_copyable
    FROM pm_copy_trading_metrics_v1
    WHERE is_copyable = 1
      AND resolved_positions >= 30
      AND win_rate >= 0.55
      AND win_rate <= 0.80  -- Exclude 80%+ which are likely arbers
      AND realized_pnl >= 1000  -- Require $1000+ PnL to show skill
    ORDER BY realized_pnl DESC
    LIMIT 20
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json();

  console.log('Top wallets with realistic win rates (55-80%) and $1000+ PnL:\n');
  for (const row of rows as any[]) {
    const w = row.wallet_address.slice(0,12);
    const wr = (row.win_rate*100).toFixed(1);
    const pnl = row.realized_pnl.toFixed(0);
    console.log(`${w}... | WR: ${wr}% | PnL: $${pnl} | Pos: ${row.resolved_positions}`);
  }
}
find().catch(console.error);
