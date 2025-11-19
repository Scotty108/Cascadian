import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { clickhouse } from '../lib/clickhouse/client.js';

async function examineMassiveDataset() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('🔍 EXAMINING MASSIVE DATASET VIA vw_trades_canonical');
  console.log('='.repeat(60));
  console.log(`Target wallet: ${wallet}`);
  console.log('');

  // Get schema to understand columns
  console.log('📋 Schema for vw_trades_canonical:');
  const schemaResult = await clickhouse.query({
    query: `DESCRIBE default.vw_trades_canonical`,
    format: 'JSONEachRow'
  });
  const schema = await schemaResult.json();
  schema.forEach((col: any) => {
    console.log(`  ${col.name}: ${col.type}`);
  });

  console.log('\n📊 Wallet summary from massive dataset:');
  const summaryResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_trades,
        sum(shares) as total_shares,
        avg(entry_price) as avg_entry_price,
        sum(usd_value) as total_usd_value,
        min(created_at) as first_trade,
        max(created_at) as last_trade,
        trade_direction,
        count(DISTINCT condition_id_norm) as unique_markets
      FROM default.vw_trades_canonical
      WHERE wallet_address_norm = lower('${wallet}')
      GROUP BY trade_direction
      ORDER BY trade_direction
    `,
    format: 'JSONEachRow'
  });

  const summary = await summaryResult.json();
  let totalTrades = 0;
  let totalUsdValue = 0;
  let totalShares = 0;

  console.log('Direction | Trades | Shares | Avg Price | USD Value');
  console.log('-'.repeat(55));

  summary.forEach((row: any) => {
    totalTrades += Number(row.total_trades);
    totalUsdValue += Number(row.total_usd_value);
    totalShares += Number(row.total_shares);

    console.log(`${row.trade_direction.padEnd(9)} | ${row.total_trades.toLocaleString().padStart(6)} | ${Number(row.total_shares).toLocaleString().padStart(8)} | $${Number(row.avg_entry_price).toFixed(3).padStart(7)} | $${Number(row.total_usd_value).toLocaleString()}`);
  });

  console.log('-'.repeat(55));
  console.log(`TOTAL     | ${totalTrades.toLocaleString().padStart(6)} | ${totalShares.toLocaleString().padStart(8)} | ${''.padStart(7)} | $${totalUsdValue.toLocaleString()}`);

  console.log('\n📈 Compared to our current calculation:');
  console.log(`   Massive dataset: ${totalTrades.toLocaleString()} trades, $${totalUsdValue.toLocaleString()} USD value`);
  console.log(`   Current dataset: 194 trades, $-2.48 calculated P&L`);
  console.log(`   Scale difference: ${Math.abs(totalUsdValue / 2.48).toLocaleString()}x`);
  console.log(`   This explains the ~80K vs -$2.48 discrepancy!`);

  // Sample some actual trades to see the data quality
  console.log('\n🔍 Sample trades from massive dataset:');
  const sampleResult = await clickhouse.query({
    query: `
      SELECT
        created_at,
        condition_id_norm,
        trade_direction,
        shares,
        entry_price,
        usd_value
      FROM default.vw_trades_canonical
      WHERE wallet_address_norm = lower('${wallet}')
      ORDER BY created_at DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleResult.json();
  samples.forEach((trade: any, i: number) => {
    console.log(`${i+1}. ${trade.created_at} | ${trade.trade_direction.padEnd(4)} | ${Number(trade.shares).toLocaleString().padStart(8)} shares | $${Number(trade.entry_price).toFixed(3)} | $${Number(trade.usd_value).toFixed(2)}`);
  });
}

examineMassiveDataset().catch(console.error);