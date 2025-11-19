import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { clickhouse } from '../lib/clickhouse/client.js';

async function checkWalletInMassiveSources() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('🔍 CHECKING WALLET IN MASSIVE TRADE DATA SOURCES');
  console.log('='.repeat(60));
  console.log(`Target wallet: ${wallet}`);
  console.log('');

  const sources = [
    {
      name: 'default.vw_trades_canonical',
      walletColumn: 'wallet_address_norm',
      additionalWhere: ''
    },
    {
      name: 'default.trades_with_direction',
      walletColumn: 'wallet_address',
      additionalWhere: ''
    },
    {
      name: 'cascadian_clean.fact_trades_clean',
      walletColumn: 'wallet_address',
      additionalWhere: ''
    },
    {
      name: 'default.clob_fills',
      walletColumn: 'lower(CAST(proxy_wallet AS String))',
      additionalWhere: ` OR lower(CAST(user_eoa AS String)) = lower('${wallet}')`
    }
  ];

  let totalTradesAcrossSources = 0;

  for (const source of sources) {
    try {
      console.log(`📊 ${source.name}:`);

      // Count total trades in source
      const totalResult = await clickhouse.query({
        query: `SELECT count() as total_trades FROM ${source.name}`,
        format: 'JSONEachRow'
      });
      const totalData = await totalResult.json();
      const totalTrades = totalData[0]?.total_trades || 0;

      // Count wallet trades
      const walletResult = await clickhouse.query({
        query: `
          SELECT count() as wallet_trades,
                 min(timestamp) as first_trade,
                 max(timestamp) as last_trade
          FROM ${source.name}
          WHERE ${source.walletColumn} = lower('${wallet}') ${source.additionalWhere}
        `,
        format: 'JSONEachRow'
      });
      const walletData = await walletResult.json();
      const walletTrades = walletData[0]?.wallet_trades || 0;

      console.log(`  Total source trades: ${totalTrades.toLocaleString()}`);
      console.log(`  Wallet trades: ${walletTrades.toLocaleString()}`);
      console.log(`  Coverage: ${((walletTrades/totalTrades)*100).toFixed(4)}%`);

      if (walletTrades > 0) {
        console.log(`  Date range: ${walletData[0]?.first_trade} to ${walletData[0]?.last_trade}`);
        totalTradesAcrossSources += walletTrades;
      }

      // Sample some wallet trades to see the data format
      if (walletTrades > 0) {
        const sampleResult = await clickhouse.query({
          query: `
            SELECT *
            FROM ${source.name}
            WHERE ${source.walletColumn} = lower('${wallet}') ${source.additionalWhere}
            ORDER BY timestamp DESC
            LIMIT 3
          `,
          format: 'JSONEachRow'
        });
        const samples = await sampleResult.json();

        console.log(`  Sample trades:`);
        samples.forEach((trade: any, i: number) => {
          const price = trade.price || trade.entry_price || 'N/A';
          const shares = trade.shares || trade.size || 'N/A';
          const timestamp = trade.timestamp || trade.block_time || 'N/A';
          console.log(`    ${i+1}. ${timestamp} | Price: ${price} | Shares: ${shares}`);
        });
      }

      console.log('');

    } catch (error: any) {
      console.log(`  ❌ Error: ${error.message}`);
      console.log('');
    }
  }

  console.log('📈 SUMMARY:');
  console.log(`Total wallet trades across all sources: ${totalTradesAcrossSources.toLocaleString()}`);
  console.log('This could explain the 32,000x P&L discrepancy!');
}

checkWalletInMassiveSources().catch(console.error);