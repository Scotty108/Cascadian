import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { clickhouse } from '../lib/clickhouse/client.js';

async function checkAllWalletTrades() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('🎯 COMPLETE WALLET TRADE ANALYSIS');
  console.log('='.repeat(60));
  console.log(`Target wallet: ${wallet}`);
  console.log('');

  // 1. vw_trades_canonical - The massive 157M trade source
  console.log('📊 1. vw_trades_canonical (157M+ trades):');
  try {
    const result = await clickhouse.query({
      query: `
        SELECT count() as wallet_trades,
               min(created_at) as first_trade,
               max(created_at) as last_trade,
               sum(shares) as total_shares,
               avg(price) as avg_price,
               sum(shares * price) as total_usd_value
        FROM default.vw_trades_canonical
        WHERE wallet_address_norm = lower('${wallet}')
      `,
      format: 'JSONEachRow'
    });

    const data = await result.json();
    const row = data[0];

    console.log(`   Wallet trades: ${row.wallet_trades.toLocaleString()}`);
    console.log(`   Date range: ${row.first_trade} to ${row.last_trade}`);
    console.log(`   Total shares: ${Number(row.total_shares).toLocaleString()}`);
    console.log(`   Average price: $${Number(row.avg_price).toFixed(4)}`);
    console.log(`   Total USD value: $${Number(row.total_usd_value).toFixed(2)}`);

  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // 2. trades_with_direction - Check date column name first
  console.log('\n📊 2. trades_with_direction (95M+ trades):');
  try {
    // Check what timestamp column it has
    const descResult = await clickhouse.query({
      query: `DESCRIBE default.trades_with_direction`,
      format: 'JSONEachRow'
    });
    const desc = await descResult.json();
    const timeColumn = desc.find((c: any) => c.name.includes('time') || c.name.includes('timestamp'))?.name || 'computed_at';

    const result = await clickhouse.query({
      query: `
        SELECT count() as wallet_trades,
               min(${timeColumn}) as first_trade,
               max(${timeColumn}) as last_trade,
               sum(shares) as total_shares,
               avg(price) as avg_price,
               sum(usd_value) as total_usd_value
        FROM default.trades_with_direction
        WHERE wallet_address = lower('${wallet}')
      `,
      format: 'JSONEachRow'
    });

    const data = await result.json();
    const row = data[0];

    console.log(`   Wallet trades: ${row.wallet_trades.toLocaleString()}`);
    console.log(`   Date range: ${row.first_trade} to ${row.last_trade}`);
    console.log(`   Total shares: ${Number(row.total_shares).toLocaleString()}`);
    console.log(`   Average price: $${Number(row.avg_price).toFixed(4)}`);
    console.log(`   Total USD value: $${Number(row.total_usd_value).toFixed(2)}`);

  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // 3. fact_trades_clean - Check timestamp column
  console.log('\n📊 3. cascadian_clean.fact_trades_clean (63M+ trades):');
  try {
    const descResult = await clickhouse.query({
      query: `DESCRIBE cascadian_clean.fact_trades_clean`,
      format: 'JSONEachRow'
    });
    const desc = await descResult.json();
    const timeColumn = desc.find((c: any) => c.name.includes('time'))?.name || 'block_time';

    const result = await clickhouse.query({
      query: `
        SELECT count() as wallet_trades,
               min(${timeColumn}) as first_trade,
               max(${timeColumn}) as last_trade,
               sum(shares) as total_shares,
               avg(price) as avg_price,
               sum(usdc_amount) as total_usd_value
        FROM cascadian_clean.fact_trades_clean
        WHERE wallet_address = lower('${wallet}')
      `,
      format: 'JSONEachRow'
    });

    const data = await result.json();
    const row = data[0];

    console.log(`   Wallet trades: ${row.wallet_trades.toLocaleString()}`);
    console.log(`   Date range: ${row.first_trade} to ${row.last_trade}`);
    console.log(`   Total shares: ${Number(row.total_shares).toLocaleString()}`);
    console.log(`   Average price: $${Number(row.avg_price).toFixed(4)}`);
    console.log(`   Total USD value: $${Number(row.total_usd_value).toFixed(2)}`);

  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // 4. Our current clob_fills for comparison
  console.log('\n📊 4. Current clob_fills (38M+ trades - our 194 subset):');
  try {
    const result = await clickhouse.query({
      query: `
        SELECT count() as wallet_trades,
               min(timestamp) as first_trade,
               max(timestamp) as last_trade,
               sum(size/1e6) as total_size_dollars,
               avg(price) as avg_price
        FROM default.clob_fills
        WHERE lower(CAST(proxy_wallet AS String)) = lower('${wallet}')
           OR lower(CAST(user_eoa AS String)) = lower('${wallet}')
      `,
      format: 'JSONEachRow'
    });

    const data = await result.json();
    const row = data[0];

    console.log(`   Wallet trades: ${row.wallet_trades.toLocaleString()}`);
    console.log(`   Date range: ${row.first_trade} to ${row.last_trade}`);
    console.log(`   Total size (dollars): $${Number(row.total_size_dollars).toFixed(2)}`);
    console.log(`   Average price: $${Number(row.avg_price).toFixed(4)}`);

  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
  }
}

checkAllWalletTrades().catch(console.error);