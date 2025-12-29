import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function main() {
  const q = await ch.query({
    query: `
      SELECT
        wallet,
        n_trades_60d as trades,
        round(p24_coverage * 100, 0) as coverage_pct,
        round(clv_24h_weighted * 100, 1) as clv_pct,
        round(clv_24h_hit_rate * 100, 0) as hit_rate_pct,
        round(notional_60d, 0) as volume,
        confidence_tier as tier
      FROM pm_wallet_forecaster_candidates_60d
      WHERE confidence_tier = 'A'
      ORDER BY clv_24h_weighted DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const rows = await q.json() as any[];

  console.log('\n🏆 Top 10 Super Forecasters (Tier A - CLOB Primary)\n');
  console.log('Rank | Wallet                                     | Trades | Cov | CLV    | Hit  | Volume');
  console.log('-----|--------------------------------------------+--------+-----+--------+------+---------');

  rows.forEach((r, i) => {
    console.log(
      `  ${(i+1).toString().padStart(2)} | ${r.wallet} | ${r.trades.toString().padStart(6)} | ${r.coverage_pct.toString().padStart(2)}% | ${r.clv_pct.toFixed(1).padStart(5)}% | ${r.hit_rate_pct.toString().padStart(3)}% | $${Number(r.volume).toLocaleString()}`
    );
  });

  console.log('\n\nPolymarket Profile Links:');
  rows.forEach((r, i) => {
    console.log(`  ${i+1}. https://polymarket.com/profile/${r.wallet}`);
  });

  await ch.close();
}
main();
