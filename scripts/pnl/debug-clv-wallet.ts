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
  const wallet = '0xbd5decf7c10f667f631e3fc8cfcf6b27bdfe9a7f';

  // Check CLV trades for this wallet
  const q = await ch.query({
    query: `
      SELECT
        trade_time,
        entry_price,
        price_24h,
        clv_24h,
        p24h_found,
        notional_usdc
      FROM pm_trade_clv_features_60d
      WHERE wallet = '${wallet}'
      ORDER BY trade_time DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });
  const trades = await q.json() as any[];

  console.log('\nCLV trades for this wallet:\n');
  console.log('Trade Time           | Entry  | Price 24h | CLV    | Found | Notional');
  console.log('---------------------|--------|-----------|--------|-------|----------');

  for (const t of trades) {
    const time = t.trade_time?.slice(0, 16) || 'N/A';
    const entry = (t.entry_price || 0).toFixed(3);
    const p24 = t.price_24h ? t.price_24h.toFixed(3) : 'NULL';
    const clv = t.clv_24h ? t.clv_24h.toFixed(3) : 'NULL';
    const found = t.p24h_found;
    const notional = (t.notional_usdc || 0).toFixed(0);
    console.log(`${time} | ${entry.padStart(6)} | ${p24.padStart(9)} | ${clv.padStart(6)} | ${found.toString().padStart(5)} | $${notional}`);
  }

  // Aggregate stats
  const statsQ = await ch.query({
    query: `
      SELECT
        count() as total_trades,
        countIf(p24h_found = 1) as with_p24,
        avg(clv_24h) as avg_clv,
        sum(clv_24h * notional_usdc) / sum(notional_usdc) as weighted_clv
      FROM pm_trade_clv_features_60d
      WHERE wallet = '${wallet}'
    `,
    format: 'JSONEachRow',
  });
  const stats = (await statsQ.json())[0] as any;

  console.log('\nAggregates:');
  console.log('  Total trades:', stats.total_trades);
  console.log('  With p24 data:', stats.with_p24);
  console.log('  Avg CLV:', stats.avg_clv?.toFixed(4));
  console.log('  Weighted CLV:', stats.weighted_clv?.toFixed(4));

  console.log('\n⚠️  PROBLEM: Sports markets resolve same-day, no 24h price data!');
  console.log('   CLV only sees non-sports trades that happened to have 24h data.');

  // Check impact of raising coverage threshold
  console.log('\n\n--- Coverage Threshold Impact ---');
  const threshQ = await ch.query({
    query: `
      SELECT
        countIf(p24_coverage >= 0.50 AND n_trades_60d >= 20 AND n_trades_with_p24 >= 15) as at_50,
        countIf(p24_coverage >= 0.75 AND n_trades_60d >= 20 AND n_trades_with_p24 >= 15) as at_75,
        countIf(p24_coverage >= 0.90 AND n_trades_60d >= 20 AND n_trades_with_p24 >= 15) as at_90
      FROM pm_wallet_clv_60d
    `,
    format: 'JSONEachRow',
  });
  const thresh = (await threshQ.json())[0] as any;
  console.log('  p24 >= 50%:', Number(thresh.at_50).toLocaleString(), 'wallets');
  console.log('  p24 >= 75%:', Number(thresh.at_75).toLocaleString(), 'wallets');
  console.log('  p24 >= 90%:', Number(thresh.at_90).toLocaleString(), 'wallets');

  await ch.close();
}
main();
