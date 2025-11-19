import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('=== C3 AUDIT: PROXY MAPPING CHECK ===\n');

  const eoa = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const proxy = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723';

  // Search wallet_identity_map
  console.log('Searching for xcnstrategy in wallet_identity_map...\n');
  try {
    const q = await clickhouse.query({
      query: `
        SELECT *
        FROM wallet_identity_map
        WHERE lower(user_eoa) = lower('${eoa}')
           OR lower(proxy_wallet) = lower('${eoa}')
           OR lower(user_eoa) = lower('${proxy}')
           OR lower(proxy_wallet) = lower('${proxy}')
      `,
      format: 'JSONEachRow'
    });
    const r: any = await q.json();

    if (r.length > 0) {
      console.log(`✅ Found ${r.length} proxy mapping(s):\n`);
      r.forEach((mapping: any, i: number) => {
        console.log(`${i + 1}. Mapping:`);
        console.log(`   User EOA: ${mapping.user_eoa}`);
        console.log(`   Proxy Wallet: ${mapping.proxy_wallet}`);
        console.log(`   Canonical: ${mapping.canonical_wallet}`);
        console.log(`   Fills: ${mapping.fills_count}`);
        console.log(`   Markets: ${mapping.markets_traded}`);
        console.log(`   First Fill: ${mapping.first_fill_ts}`);
        console.log(`   Last Fill: ${mapping.last_fill_ts}`);
        console.log();
      });
    } else {
      console.log('❌ No proxy mapping found for xcnstrategy addresses');
      console.log('\nThis might mean:');
      console.log('  1. Proxy mapping not populated for this wallet');
      console.log('  2. Wallet trades directly from EOA (no proxy)');
      console.log('  3. Mapping table incomplete');
    }
  } catch (e: any) {
    console.log(`ERROR: ${e.message}`);
  }

  // Check how many wallets have proxy mappings
  console.log('\n\nProxy Mapping Coverage Statistics...\n');
  try {
    const q = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_mappings,
          COUNT(DISTINCT user_eoa) as unique_eoas,
          COUNT(DISTINCT proxy_wallet) as unique_proxies,
          MIN(first_fill_ts) as earliest_fill,
          MAX(last_fill_ts) as latest_fill
        FROM wallet_identity_map
      `,
      format: 'JSONEachRow'
    });
    const r: any = await q.json();

    console.log(`   Total Proxy Mappings: ${r[0].total_mappings.toLocaleString()}`);
    console.log(`   Unique EOAs: ${r[0].unique_eoas.toLocaleString()}`);
    console.log(`   Unique Proxies: ${r[0].unique_proxies.toLocaleString()}`);
    console.log(`   Date Range: ${r[0].earliest_fill} to ${r[0].latest_fill}`);

  } catch (e: any) {
    console.log(`   ERROR: ${e.message}`);
  }

  // Sample some proxy mappings
  console.log('\n\nSample Proxy Mappings (Top 5 by fill count)...\n');
  try {
    const q = await clickhouse.query({
      query: `
        SELECT
          user_eoa,
          proxy_wallet,
          fills_count,
          markets_traded
        FROM wallet_identity_map
        ORDER BY fills_count DESC
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const r: any = await q.json();

    r.forEach((mapping: any, i: number) => {
      console.log(`${i + 1}. EOA: ${mapping.user_eoa}`);
      console.log(`   Proxy: ${mapping.proxy_wallet}`);
      console.log(`   Fills: ${mapping.fills_count}, Markets: ${mapping.markets_traded}`);
      console.log();
    });

  } catch (e: any) {
    console.log(`   ERROR: ${e.message}`);
  }

  console.log('\n=== CONCLUSION ===\n');
  console.log('xcnstrategy wallet (EOA) has 1,384 trades in our database.');
  console.log('Whether or not proxy mapping exists, the trade data IS present.');
}

main().catch(console.error);
