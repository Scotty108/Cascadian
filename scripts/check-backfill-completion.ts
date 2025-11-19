#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

async function checkCompletion() {
  console.log('\n🎉 CHECKING BACKFILL COMPLETION STATUS');
  console.log('='.repeat(80));

  const status = await client.query({
    query: `
      SELECT
        count(*) as total_erc1155_events,
        count(DISTINCT tx_hash) as unique_txs_covered,
        min(block_number) as earliest_block,
        max(block_number) as latest_block,

        (SELECT count(DISTINCT transaction_hash)
         FROM trades_raw
         WHERE transaction_hash != '' AND length(transaction_hash) = 66
        ) as total_txs_needed,

        unique_txs_covered * 100.0 / total_txs_needed as coverage_pct,

        (SELECT count(DISTINCT tx_hash)
         FROM trades_with_direction
        ) as current_direction_txs

      FROM erc1155_transfers
    `,
    format: 'JSONEachRow',
  });
  const data: any = (await status.json())[0];

  console.log(`\n📊 ERC1155 Transfers Table:`);
  console.log(`   Total events: ${parseInt(data.total_erc1155_events).toLocaleString()}`);
  console.log(`   Unique transactions: ${parseInt(data.unique_txs_covered).toLocaleString()}`);
  console.log(`   Block range: ${parseInt(data.earliest_block).toLocaleString()} → ${parseInt(data.latest_block).toLocaleString()}`);

  console.log(`\n🎯 Coverage Analysis:`);
  console.log(`   Transactions needed: ${parseInt(data.total_txs_needed).toLocaleString()}`);
  console.log(`   Transactions covered: ${parseInt(data.unique_txs_covered).toLocaleString()}`);
  console.log(`   Coverage: ${parseFloat(data.coverage_pct).toFixed(1)}%`);

  console.log(`\n📋 trades_with_direction Status:`);
  console.log(`   Current unique txs: ${parseInt(data.current_direction_txs).toLocaleString()}`);

  if (parseFloat(data.coverage_pct) >= 95) {
    console.log('\n\n🎉🎉🎉 BACKFILL COMPLETE! 🎉🎉🎉');
    console.log('   Ready to extract condition_ids and achieve 100% wallet coverage!\n');

    console.log('Next steps:');
    console.log('   1. Extract condition_ids from erc1155_transfers');
    console.log('   2. Join with existing trade data');
    console.log('   3. Insert into trades_with_direction');
    console.log('   4. Verify 100% wallet coverage\n');

  } else if (parseFloat(data.coverage_pct) >= 50) {
    console.log(`\n\n⚡ SIGNIFICANT PROGRESS: ${parseFloat(data.coverage_pct).toFixed(1)}% complete`);
    console.log('   Getting close! Let it continue running.\n');

  } else if (parseFloat(data.coverage_pct) >= 10) {
    console.log(`\n\n⏳ IN PROGRESS: ${parseFloat(data.coverage_pct).toFixed(1)}% complete`);
    console.log('   Still running, be patient.\n');

  } else {
    console.log(`\n\n⏳ EARLY STAGES: ${parseFloat(data.coverage_pct).toFixed(1)}% complete`);
    console.log('   Still a ways to go.\n');
  }

  // Check how many missing transactions we can now recover
  console.log('📊 Recovery Potential for Top Wallet:');
  const topWallet = '0x5f4d4927ea3ca72c9735f56778cfbb046c186be0';

  const recoveryCheck = await client.query({
    query: `
      WITH missing_from_direction AS (
        SELECT DISTINCT transaction_hash
        FROM trades_raw
        WHERE wallet_address = {wallet:String}
          AND transaction_hash NOT IN (
            SELECT DISTINCT tx_hash FROM trades_with_direction WHERE wallet_address = {wallet:String}
          )
          AND transaction_hash != ''
          AND length(transaction_hash) = 66
      )
      SELECT
        (SELECT count() FROM missing_from_direction) as total_missing,
        count(DISTINCT e.tx_hash) as can_recover_now,
        can_recover_now * 100.0 / total_missing as recovery_pct
      FROM missing_from_direction m
      INNER JOIN erc1155_transfers e ON m.transaction_hash = e.tx_hash
    `,
    query_params: { wallet: topWallet },
    format: 'JSONEachRow',
  });
  const recoveryData: any = (await recoveryCheck.json())[0];

  console.log(`   Wallet: ${topWallet}`);
  console.log(`   Missing transactions: ${parseInt(recoveryData.total_missing).toLocaleString()}`);
  console.log(`   Can recover now: ${parseInt(recoveryData.can_recover_now).toLocaleString()} (${parseFloat(recoveryData.recovery_pct).toFixed(1)}%)\n`);

  await client.close();
}

checkCompletion().catch(console.error);
