import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('=== C3 AUDIT: XCNSTRATEGY WITH PROXY ADDRESSES ===\n');

  const xcnAddresses = {
    eoa: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
    proxy: '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723',
    originalSearch: '0xc26d5b9ad6153c5b39b93e29d0d4a7d65cba84b6'
  };

  console.log('Target Addresses:');
  console.log(`  EOA:    ${xcnAddresses.eoa}`);
  console.log(`  Proxy:  ${xcnAddresses.proxy}`);
  console.log(`  (Previous search: ${xcnAddresses.originalSearch})`);
  console.log();

  // Check each address in vw_trades_canonical
  console.log('=== CHECKING vw_trades_canonical ===\n');
  for (const [type, address] of Object.entries(xcnAddresses)) {
    try {
      const q = await clickhouse.query({
        query: `
          SELECT
            COUNT(*) as count,
            min(timestamp) as min_date,
            max(timestamp) as max_date,
            COUNT(DISTINCT market_id_norm) as unique_markets
          FROM vw_trades_canonical
          WHERE lower(wallet_address_norm) = lower('${address}')
        `,
        format: 'JSONEachRow'
      });
      const r: any = await q.json();

      if (r[0].count > 0) {
        console.log(`✅ ${type.toUpperCase()} (${address})`);
        console.log(`   Trades: ${r[0].count.toLocaleString()}`);
        console.log(`   Date Range: ${r[0].min_date} to ${r[0].max_date}`);
        console.log(`   Unique Markets: ${r[0].unique_markets}`);
      } else {
        console.log(`❌ ${type.toUpperCase()} (${address})`);
        console.log(`   No trades found`);
      }
      console.log();
    } catch (e: any) {
      console.log(`⚠️  ${type.toUpperCase()}: ERROR - ${e.message}\n`);
    }
  }

  // Check wallet_metrics_complete
  console.log('=== CHECKING wallet_metrics_complete ===\n');
  for (const [type, address] of Object.entries(xcnAddresses)) {
    try {
      const q = await clickhouse.query({
        query: `
          SELECT
            wallet_address,
            metric_9_net_pnl_usd,
            trades_analyzed,
            resolved_trades,
            metric_2_omega_net
          FROM wallet_metrics_complete
          WHERE lower(wallet_address) = lower('${address}')
            AND window = 'lifetime'
        `,
        format: 'JSONEachRow'
      });
      const r: any = await q.json();

      if (r.length > 0) {
        console.log(`✅ ${type.toUpperCase()} (${address})`);
        console.log(`   PnL: $${parseFloat(r[0].metric_9_net_pnl_usd).toLocaleString()}`);
        console.log(`   Trades: ${r[0].trades_analyzed.toLocaleString()}`);
        console.log(`   Resolved: ${r[0].resolved_trades.toLocaleString()}`);
        console.log(`   Omega: ${r[0].metric_2_omega_net}`);
      } else {
        console.log(`❌ ${type.toUpperCase()} (${address})`);
        console.log(`   No metrics found`);
      }
      console.log();
    } catch (e: any) {
      console.log(`⚠️  ${type.toUpperCase()}: ERROR - ${e.message}\n`);
    }
  }

  // Check CLOB fills
  console.log('=== CHECKING clob_fills ===\n');
  for (const [type, address] of Object.entries(xcnAddresses)) {
    try {
      const q = await clickhouse.query({
        query: `
          SELECT
            COUNT(*) as count,
            COUNT(DISTINCT asset_id) as unique_assets
          FROM clob_fills
          WHERE lower(user_eoa) = lower('${address}')
             OR lower(proxy_wallet) = lower('${address}')
        `,
        format: 'JSONEachRow'
      });
      const r: any = await q.json();

      if (r[0].count > 0) {
        console.log(`✅ ${type.toUpperCase()} (${address})`);
        console.log(`   Fills: ${r[0].count.toLocaleString()}`);
        console.log(`   Unique Assets: ${r[0].unique_assets}`);
      } else {
        console.log(`❌ ${type.toUpperCase()} (${address})`);
        console.log(`   No fills found`);
      }
      console.log();
    } catch (e: any) {
      console.log(`⚠️  ${type.toUpperCase()}: ERROR - ${e.message}\n`);
    }
  }

  // Check wallet_identity_map
  console.log('=== CHECKING wallet_identity_map ===\n');
  try {
    const q = await clickhouse.query({
      query: `
        SELECT *
        FROM wallet_identity_map
        WHERE lower(eoa) IN (lower('${xcnAddresses.eoa}'), lower('${xcnAddresses.proxy}'))
           OR lower(proxy) IN (lower('${xcnAddresses.eoa}'), lower('${xcnAddresses.proxy}'))
      `,
      format: 'JSONEachRow'
    });
    const r: any = await q.json();

    if (r.length > 0) {
      console.log(`✅ Found ${r.length} wallet identity mapping(s):`);
      r.forEach((mapping: any) => {
        console.log(`\n   EOA: ${mapping.eoa}`);
        console.log(`   Proxy: ${mapping.proxy}`);
        console.log(`   Type: ${mapping.wallet_type}`);
        if (mapping.name) console.log(`   Name: ${mapping.name}`);
      });
    } else {
      console.log('❌ No wallet identity mappings found');
    }
  } catch (e: any) {
    console.log(`⚠️  ERROR: ${e.message}`);
  }

  // Sample trades from proxy address
  console.log('\n\n=== SAMPLE TRADES (if found) ===\n');
  for (const [type, address] of Object.entries(xcnAddresses)) {
    try {
      const q = await clickhouse.query({
        query: `
          SELECT
            timestamp,
            market_id_norm,
            outcome_token,
            trade_direction,
            shares,
            price
          FROM vw_trades_canonical
          WHERE lower(wallet_address_norm) = lower('${address}')
          ORDER BY timestamp DESC
          LIMIT 5
        `,
        format: 'JSONEachRow'
      });
      const r: any = await q.json();

      if (r.length > 0) {
        console.log(`Sample trades for ${type.toUpperCase()}:\n`);
        r.forEach((trade: any, i: number) => {
          console.log(`${i + 1}. ${trade.timestamp} - ${trade.outcome_token} ${trade.trade_direction}`);
          console.log(`   Shares: ${trade.shares}, Price: ${trade.price}`);
        });
        console.log();
      }
    } catch (e: any) {
      // Skip if no data
    }
  }

  console.log('\n=== SUMMARY ===\n');
  console.log('xcnstrategy Safe Wallet:');
  console.log(`  EOA:   ${xcnAddresses.eoa}`);
  console.log(`  Proxy: ${xcnAddresses.proxy}`);
  console.log('\nThis checks if either address exists in our database.');
}

main().catch(console.error);
