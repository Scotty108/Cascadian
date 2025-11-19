import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('=== C3 AUDIT: VERIFY DATA EXISTS AT ALL ===\n');

  // Check if vw_trades_canonical has ANY data
  console.log('1. Checking vw_trades_canonical...\n');
  try {
    const q1 = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_trades,
          COUNT(DISTINCT wallet_address_norm) as unique_wallets,
          min(timestamp) as earliest_trade,
          max(timestamp) as latest_trade
        FROM vw_trades_canonical
      `,
      format: 'JSONEachRow'
    });
    const r1: any = await q1.json();
    console.log(`   Total Trades: ${r1[0].total_trades.toLocaleString()}`);
    console.log(`   Unique Wallets: ${r1[0].unique_wallets.toLocaleString()}`);
    console.log(`   Date Range: ${r1[0].earliest_trade} to ${r1[0].latest_trade}`);

    // Sample top wallets
    if (r1[0].unique_wallets > 0) {
      const q1b = await clickhouse.query({
        query: `
          SELECT
            wallet_address_norm,
            COUNT(*) as trade_count
          FROM vw_trades_canonical
          GROUP BY wallet_address_norm
          ORDER BY trade_count DESC
          LIMIT 10
        `,
        format: 'JSONEachRow'
      });
      const r1b: any = await q1b.json();
      console.log('\n   Top 10 Wallets by Trade Count:');
      r1b.forEach((w: any, i: number) => {
        console.log(`   ${(i + 1).toString().padStart(2)}. ${w.wallet_address_norm} - ${w.trade_count.toLocaleString()} trades`);
      });
    }
  } catch (e: any) {
    console.log(`   ERROR: ${e.message}`);
  }

  console.log('\n\n2. Checking wallet_metrics_complete...\n');
  try {
    const q2 = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_wallets,
          COUNT(DISTINCT wallet_address) as unique_wallets
        FROM wallet_metrics_complete
      `,
      format: 'JSONEachRow'
    });
    const r2: any = await q2.json();
    console.log(`   Total Records: ${r2[0].total_wallets.toLocaleString()}`);
    console.log(`   Unique Wallets: ${r2[0].unique_wallets.toLocaleString()}`);

    // Sample top wallets by PnL
    const q2b = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          metric_9_net_pnl_usd,
          trades_analyzed
        FROM wallet_metrics_complete
        WHERE window = 'lifetime'
        ORDER BY metric_9_net_pnl_usd DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const r2b: any = await q2b.json();
    console.log('\n   Top 10 Wallets by Net PnL:');
    r2b.forEach((w: any, i: number) => {
      console.log(`   ${(i + 1).toString().padStart(2)}. ${w.wallet_address}`);
      console.log(`       PnL: $${parseFloat(w.metric_9_net_pnl_usd).toLocaleString()} | Trades: ${w.trades_analyzed}`);
    });
  } catch (e: any) {
    console.log(`   ERROR: ${e.message}`);
  }

  console.log('\n\n3. Searching for xcnstrategy wallet...\n');
  const xcnVariants = [
    '0xc26d5b9ad6153c5b39b93e29d0d4a7d65cba84b6',
    'c26d5b9ad6153c5b39b93e29d0d4a7d65cba84b6',
    '0xC26D5b9ad6153c5B39b93E29d0D4a7D65cba84B6'
  ];

  for (const variant of xcnVariants) {
    try {
      const q3 = await clickhouse.query({
        query: `
          SELECT
            wallet_address,
            metric_9_net_pnl_usd,
            trades_analyzed
          FROM wallet_metrics_complete
          WHERE wallet_address ILIKE '%${variant}%'
          LIMIT 5
        `,
        format: 'JSONEachRow'
      });
      const r3: any = await q3.json();
      if (r3.length > 0) {
        console.log(`   ✅ FOUND variant: ${variant}`);
        r3.forEach((w: any) => {
          console.log(`      ${w.wallet_address} - $${w.metric_9_net_pnl_usd} PnL, ${w.trades_analyzed} trades`);
        });
      } else {
        console.log(`   ❌ NOT FOUND: ${variant}`);
      }
    } catch (e: any) {
      console.log(`   ERROR searching ${variant}: ${e.message}`);
    }
  }

  console.log('\n\n4. Checking clob_fills for any data...\n');
  try {
    const q4 = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_fills,
          COUNT(DISTINCT user_eoa) as unique_wallets
        FROM clob_fills
      `,
      format: 'JSONEachRow'
    });
    const r4: any = await q4.json();
    console.log(`   Total Fills: ${r4[0].total_fills.toLocaleString()}`);
    console.log(`   Unique Wallets: ${r4[0].unique_wallets.toLocaleString()}`);
  } catch (e: any) {
    console.log(`   ERROR: ${e.message}`);
  }
}

main().catch(console.error);
