import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('=== C3 AUDIT: XCNSTRATEGY WALLET COVERAGE (PROPER) ===\n');

  const xcnWallet = '0xc26d5b9ad6153c5b39b93e29d0d4a7d65cba84b6';
  console.log(`Target Wallet: ${xcnWallet}\n`);

  console.log('=== TRADE DATA COVERAGE ===\n');

  // 1. vw_trades_canonical
  try {
    const q1 = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as count,
          min(timestamp) as min_date,
          max(timestamp) as max_date,
          COUNT(DISTINCT market_id_norm) as unique_markets
        FROM vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${xcnWallet}')
      `,
      format: 'JSONEachRow'
    });
    const r1: any = await q1.json();
    console.log(`✅ vw_trades_canonical (canonical view)`);
    console.log(`   Trades: ${r1[0].count.toLocaleString()}`);
    console.log(`   Date Range: ${r1[0].min_date} to ${r1[0].max_date}`);
    console.log(`   Unique Markets: ${r1[0].unique_markets}`);
  } catch (e: any) {
    console.log(`❌ vw_trades_canonical: ${e.message}`);
  }

  console.log();

  // 2. clob_fills
  try {
    const q2 = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as count,
          min(created_at) as min_date,
          max(created_at) as max_date,
          COUNT(DISTINCT asset_id) as unique_assets
        FROM clob_fills
        WHERE lower(user_eoa) = lower('${xcnWallet}')
      `,
      format: 'JSONEachRow'
    });
    const r2: any = await q2.json();
    console.log(`✅ clob_fills (CLOB order fills)`);
    console.log(`   Fills: ${r2[0].count.toLocaleString()}`);
    console.log(`   Date Range: ${r2[0].min_date} to ${r2[0].max_date}`);
    console.log(`   Unique Assets: ${r2[0].unique_assets}`);
  } catch (e: any) {
    console.log(`❌ clob_fills: ${e.message}`);
  }

  console.log();

  // 3. fact_trades_clean
  try {
    const q3 = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as count,
          min(block_time) as min_date,
          max(block_time) as max_date,
          COUNT(DISTINCT cid) as unique_conditions
        FROM fact_trades_clean
        WHERE lower(wallet_address) = lower('${xcnWallet}')
      `,
      format: 'JSONEachRow'
    });
    const r3: any = await q3.json();
    console.log(`✅ fact_trades_clean (cleaned trades)`);
    console.log(`   Trades: ${r3[0].count.toLocaleString()}`);
    console.log(`   Date Range: ${r3[0].min_date} to ${r3[0].max_date}`);
    console.log(`   Unique Conditions: ${r3[0].unique_conditions}`);
  } catch (e: any) {
    console.log(`❌ fact_trades_clean: ${e.message}`);
  }

  console.log();

  // 4. ERC1155 transfers
  try {
    const q4 = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as count,
          min(block_timestamp) as min_date,
          max(block_timestamp) as max_date
        FROM erc1155_transfers
        WHERE lower(from_address) = lower('${xcnWallet}')
           OR lower(to_address) = lower('${xcnWallet}')
      `,
      format: 'JSONEachRow'
    });
    const r4: any = await q4.json();
    console.log(`✅ erc1155_transfers (blockchain token transfers)`);
    console.log(`   Transfers: ${r4[0].count.toLocaleString()}`);
    console.log(`   Date Range: ${r4[0].min_date} to ${r4[0].max_date}`);
  } catch (e: any) {
    console.log(`❌ erc1155_transfers: ${e.message}`);
  }

  console.log();

  console.log('=== WALLET ANALYTICS ===\n');

  // 5. wallet_metrics_complete
  try {
    const q5 = await clickhouse.query({
      query: `
        SELECT *
        FROM wallet_metrics_complete
        WHERE lower(wallet_address) = lower('${xcnWallet}')
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });
    const r5: any = await q5.json();
    if (r5.length > 0) {
      console.log(`✅ wallet_metrics_complete`);
      console.log(`   Omega Net: ${r5[0].metric_2_omega_net}`);
      console.log(`   Net PnL: $${r5[0].metric_9_net_pnl_usd}`);
      console.log(`   Trades Analyzed: ${r5[0].trades_analyzed}`);
      console.log(`   Resolved Trades: ${r5[0].resolved_trades}`);
    } else {
      console.log(`❌ wallet_metrics_complete: No data`);
    }
  } catch (e: any) {
    console.log(`❌ wallet_metrics_complete: ${e.message}`);
  }

  console.log();

  // 6. outcome_positions
  try {
    const q6 = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as count,
          COUNT(DISTINCT condition_id_norm) as unique_conditions
        FROM outcome_positions_v2_backup_20251112T061455
        WHERE lower(wallet) = lower('${xcnWallet}')
      `,
      format: 'JSONEachRow'
    });
    const r6: any = await q6.json();
    console.log(`✅ outcome_positions (historical snapshot)`);
    console.log(`   Positions: ${r6[0].count.toLocaleString()}`);
    console.log(`   Unique Conditions: ${r6[0].unique_conditions}`);
  } catch (e: any) {
    console.log(`❌ outcome_positions: ${e.message}`);
  }

  console.log('\n=== SUMMARY ===\n');
  console.log(`Wallet: ${xcnWallet} (xcnstrategy)`);
  console.log(`\nThis shows what WE HAVE in our database.`);
  console.log(`To determine completeness, we'd need to compare vs Polymarket API.`);
}

main().catch(console.error);
