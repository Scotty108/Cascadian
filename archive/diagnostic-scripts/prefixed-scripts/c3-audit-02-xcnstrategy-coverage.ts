import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('=== C3 AUDIT: XCNSTRATEGY WALLET COVERAGE ===\n');

  const xcnWallet = '0xc26d5b9ad6153c5b39b93e29d0d4a7d65cba84b6';
  console.log(`Target Wallet: ${xcnWallet}\n`);

  // Check all major tables for this wallet
  const tables = [
    { name: 'vw_trades_canonical', walletField: 'wallet' },
    { name: 'clob_fills', walletField: 'wallet' },
    { name: 'trades_with_direction', walletField: 'wallet' },
    { name: 'fact_trades_clean', walletField: 'wallet' },
    { name: 'erc1155_transfers', walletField: 'wallet' },
    { name: 'wallet_metrics_complete', walletField: 'wallet' },
    { name: 'outcome_positions_v2_backup_20251112T061455', walletField: 'wallet' }
  ];

  console.log('=== TRADE & POSITION DATA ===\n');

  for (const table of tables) {
    try {
      const countQuery = await clickhouse.query({
        query: `
          SELECT COUNT(*) as count
          FROM ${table.name}
          WHERE lower(${table.walletField}) = lower('${xcnWallet}')
        `,
        format: 'JSONEachRow'
      });
      const result: any = await countQuery.json();
      const count = result[0]?.count || 0;

      const status = count > 0 ? '✅' : '❌';
      console.log(`${status} ${table.name.padEnd(50)} ${count.toLocaleString().padStart(10)} rows`);

      // If found, get date range
      if (count > 0) {
        try {
          const dateQuery = await clickhouse.query({
            query: `
              SELECT
                min(timestamp) as min_date,
                max(timestamp) as max_date
              FROM ${table.name}
              WHERE lower(${table.walletField}) = lower('${xcnWallet}')
            `,
            format: 'JSONEachRow'
          });
          const dateResult: any = await dateQuery.json();
          if (dateResult[0]) {
            console.log(`   Date Range: ${dateResult[0].min_date} to ${dateResult[0].max_date}`);
          }
        } catch (e) {
          // Table might not have timestamp field
        }
      }
    } catch (error: any) {
      console.log(`⚠️  ${table.name.padEnd(50)} ERROR: ${error.message}`);
    }
  }

  // Check external_trades_raw if it exists
  console.log('\n=== EXTERNAL DATA SOURCES ===\n');

  try {
    const externalQuery = await clickhouse.query({
      query: `
        SELECT COUNT(*) as count
        FROM external_trades_raw
        WHERE lower(wallet) = lower('${xcnWallet}')
      `,
      format: 'JSONEachRow'
    });
    const result: any = await externalQuery.json();
    console.log(`✅ external_trades_raw                                  ${result[0].count.toLocaleString().padStart(10)} rows`);
  } catch (e) {
    console.log('❌ external_trades_raw                                  NOT FOUND');
  }

  // Get sample trade data from best source
  console.log('\n=== SAMPLE TRADE DATA ===\n');

  try {
    const sampleQuery = await clickhouse.query({
      query: `
        SELECT
          timestamp,
          asset_id,
          side,
          size,
          price
        FROM vw_trades_canonical
        WHERE lower(wallet) = lower('${xcnWallet}')
        ORDER BY timestamp DESC
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const samples: any[] = await sampleQuery.json();

    if (samples.length > 0) {
      console.log('Recent trades:');
      samples.forEach((trade, i) => {
        console.log(`\n${i + 1}. ${trade.timestamp}`);
        console.log(`   Asset: ${trade.asset_id}`);
        console.log(`   Side: ${trade.side}, Size: ${trade.size}, Price: ${trade.price}`);
      });
    }
  } catch (e: any) {
    console.log(`ERROR getting sample data: ${e.message}`);
  }

  // Summary
  console.log('\n\n=== SUMMARY ===\n');
  console.log('✅ = Data exists for this wallet');
  console.log('❌ = No data found');
  console.log('\nThis audit shows CURRENT state of existing data.');
  console.log('It does NOT show what SHOULD be there (need to compare vs Polymarket API).');
}

main().catch(console.error);
