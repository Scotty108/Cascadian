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
  request_timeout: 600000,
});

async function completeDiagnostic() {
  console.log('\n🎯 COMPLETE COVERAGE DIAGNOSTIC FOR WALLET PNL CALCULATION');
  console.log('='.repeat(80));
  console.log('Goal: 100% trade coverage for accurate win rate, omega ratio, ROI, PnL by category\n');

  console.log('📊 PART 1: GLOBAL COVERAGE COMPARISON');
  console.log('='.repeat(80));

  // Global unique transaction counts
  const globalCoverage = await client.query({
    query: `
      SELECT
        'trades_raw' as source,
        count() as total_rows,
        count(DISTINCT transaction_hash) as unique_txs,
        countIf(condition_id != '' AND length(condition_id) >= 64) as has_condition_id,
        has_condition_id * 100.0 / total_rows as condition_id_pct
      FROM trades_raw
      WHERE transaction_hash != ''
        AND length(transaction_hash) = 66

      UNION ALL

      SELECT
        'trades_with_direction' as source,
        count() as total_rows,
        count(DISTINCT tx_hash) as unique_txs,
        countIf(condition_id_norm != '' AND length(condition_id_norm) >= 64) as has_condition_id,
        has_condition_id * 100.0 / total_rows as condition_id_pct
      FROM trades_with_direction

      UNION ALL

      SELECT
        'trade_direction_assignments' as source,
        count() as total_rows,
        count(DISTINCT tx_hash) as unique_txs,
        countIf(condition_id_norm != '' AND length(condition_id_norm) >= 64) as has_condition_id,
        has_condition_id * 100.0 / total_rows as condition_id_pct
      FROM trade_direction_assignments

      UNION ALL

      SELECT
        'vw_trades_canonical' as source,
        count() as total_rows,
        count(DISTINCT transaction_hash) as unique_txs,
        countIf(
          condition_id_norm != ''
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND length(condition_id_norm) >= 64
        ) as has_condition_id,
        has_condition_id * 100.0 / total_rows as condition_id_pct
      FROM vw_trades_canonical

      ORDER BY unique_txs DESC
    `,
    format: 'JSONEachRow',
  });
  console.log('\nGlobal Coverage:');
  const globalData = await globalCoverage.json();
  globalData.forEach((row: any) => {
    console.log(`\n${row.source}:`);
    console.log(`  Total rows: ${parseInt(row.total_rows).toLocaleString()}`);
    console.log(`  Unique txs: ${parseInt(row.unique_txs).toLocaleString()}`);
    console.log(`  Has condition_id: ${parseInt(row.has_condition_id).toLocaleString()} (${parseFloat(row.condition_id_pct).toFixed(1)}%)`);
  });

  console.log('\n\n🔍 PART 2: PER-WALLET COVERAGE GAPS');
  console.log('='.repeat(80));
  console.log('Testing if ANY wallet is missing trades in trades_with_direction...\n');

  const walletGaps = await client.query({
    query: `
      WITH raw_wallet_txs AS (
        SELECT
          wallet_address,
          count(DISTINCT transaction_hash) as txs_in_raw
        FROM trades_raw
        WHERE transaction_hash != ''
          AND length(transaction_hash) = 66
        GROUP BY wallet_address
      ),
      direction_wallet_txs AS (
        SELECT
          wallet_address,
          count(DISTINCT tx_hash) as txs_in_direction
        FROM trades_with_direction
        GROUP BY wallet_address
      )
      SELECT
        r.wallet_address,
        r.txs_in_raw,
        COALESCE(d.txs_in_direction, 0) as txs_in_direction,
        r.txs_in_raw - COALESCE(d.txs_in_direction, 0) as missing_txs,
        missing_txs * 100.0 / r.txs_in_raw as missing_pct
      FROM raw_wallet_txs r
      LEFT JOIN direction_wallet_txs d ON r.wallet_address = d.wallet_address
      WHERE missing_txs > 0
      ORDER BY missing_txs DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });
  const gaps = await walletGaps.json();

  if (gaps.length === 0) {
    console.log('✅ PERFECT! No wallets are missing any transactions.');
    console.log('   trades_with_direction has 100% coverage for all wallets.\n');
  } else {
    console.log(`❌ CRITICAL: Found ${gaps.length}+ wallets with missing transactions:\n`);
    gaps.forEach((w: any, i: number) => {
      console.log(`${i+1}. Wallet: ${w.wallet_address}`);
      console.log(`   trades_raw: ${parseInt(w.txs_in_raw).toLocaleString()} txs`);
      console.log(`   trades_with_direction: ${parseInt(w.txs_in_direction).toLocaleString()} txs`);
      console.log(`   MISSING: ${parseInt(w.missing_txs).toLocaleString()} txs (${parseFloat(w.missing_pct).toFixed(1)}%)\n`);
    });
  }

  console.log('\n📋 PART 3: QUALITY OF MISSING TRANSACTIONS');
  console.log('='.repeat(80));
  console.log('Are missing transactions real or phantom data?\n');

  const topWallet = gaps.length > 0 ? gaps[0].wallet_address : '0x5f4d4927ea3ca72c9735f56778cfbb046c186be0';

  const missingQuality = await client.query({
    query: `
      WITH missing_txs AS (
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
        (SELECT count() FROM missing_txs) as total_missing,

        -- Are they in other tables?
        (SELECT count(DISTINCT v.transaction_hash)
         FROM vw_trades_canonical v
         INNER JOIN missing_txs m ON v.transaction_hash = m.transaction_hash
         WHERE v.wallet_address_norm = {wallet:String}
        ) as in_vw_canonical,

        (SELECT count(DISTINCT t.tx_hash)
         FROM trade_direction_assignments t
         INNER JOIN missing_txs m ON t.tx_hash = m.transaction_hash
         WHERE t.wallet_address = {wallet:String}
        ) as in_tda,

        (SELECT count(DISTINCT e.tx_hash)
         FROM erc1155_transfers e
         INNER JOIN missing_txs m ON e.tx_hash = m.transaction_hash
        ) as in_erc1155,

        -- Do they have valid data?
        (SELECT count(DISTINCT v.transaction_hash)
         FROM vw_trades_canonical v
         INNER JOIN missing_txs m ON v.transaction_hash = m.transaction_hash
         WHERE v.wallet_address_norm = {wallet:String}
           AND v.condition_id_norm != ''
           AND v.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        ) as has_valid_condition_id
    `,
    query_params: { wallet: topWallet },
    format: 'JSONEachRow',
  });
  const qualityData: any = (await missingQuality.json())[0];

  console.log(`Focus wallet: ${topWallet}`);
  console.log(`Total missing transactions: ${parseInt(qualityData.total_missing).toLocaleString()}\n`);
  console.log(`Found in other tables:`);
  console.log(`  vw_trades_canonical: ${parseInt(qualityData.in_vw_canonical).toLocaleString()}`);
  console.log(`  trade_direction_assignments: ${parseInt(qualityData.in_tda).toLocaleString()}`);
  console.log(`  erc1155_transfers: ${parseInt(qualityData.in_erc1155).toLocaleString()}\n`);
  console.log(`Has valid condition_id in other tables: ${parseInt(qualityData.has_valid_condition_id).toLocaleString()}\n`);

  console.log('\n⚡ PART 4: CAN WE RECOVER FROM EXISTING TABLES?');
  console.log('='.repeat(80));

  if (parseInt(qualityData.has_valid_condition_id) > 0) {
    console.log('✅ YES! We can recover from existing tables!\n');

    const recoveryTest = await client.query({
      query: `
        WITH missing_txs AS (
          SELECT DISTINCT transaction_hash
          FROM trades_raw
          WHERE wallet_address = {wallet:String}
            AND transaction_hash NOT IN (
              SELECT DISTINCT tx_hash FROM trades_with_direction WHERE wallet_address = {wallet:String}
            )
            AND transaction_hash != ''
            AND length(transaction_hash) = 66
          LIMIT 10
        )
        SELECT
          COALESCE(v.transaction_hash, t.tx_hash) as tx_hash,
          COALESCE(
            NULLIF(v.condition_id_norm, '0x0000000000000000000000000000000000000000000000000000000000000000'),
            t.condition_id_norm
          ) as recovered_condition_id,
          length(recovered_condition_id) as cond_len,
          COALESCE(v.usd_value, t.usd_value) as usd_value,
          COALESCE(v.shares, t.shares) as shares
        FROM missing_txs m
        LEFT JOIN vw_trades_canonical v
          ON m.transaction_hash = v.transaction_hash
          AND v.wallet_address_norm = {wallet:String}
        LEFT JOIN trade_direction_assignments t
          ON m.transaction_hash = t.tx_hash
          AND t.wallet_address = {wallet:String}
        WHERE recovered_condition_id IS NOT NULL
          AND recovered_condition_id != ''
        LIMIT 10
      `,
      query_params: { wallet: topWallet },
      format: 'JSONEachRow',
    });
    console.log('Sample recovery:');
    console.log(await recoveryTest.json());

  } else {
    console.log('❌ NO - missing transactions have no valid condition_ids in any table.\n');
    console.log('Blockchain backfill IS necessary to extract condition_ids from ERC1155 events.\n');
  }

  console.log('\n🎯 PART 5: BLOCKCHAIN BACKFILL STATUS');
  console.log('='.repeat(80));

  const backfillStatus = await client.query({
    query: `
      SELECT
        count(*) as total_erc1155_events,
        count(DISTINCT tx_hash) as unique_txs_with_events,
        min(block_number) as earliest_block,
        max(block_number) as latest_block,
        (SELECT count(DISTINCT transaction_hash) FROM trades_raw
         WHERE transaction_hash != '' AND length(transaction_hash) = 66
        ) as total_raw_txs,
        unique_txs_with_events * 100.0 / total_raw_txs as coverage_pct
      FROM erc1155_transfers
    `,
    format: 'JSONEachRow',
  });
  const backfillData: any = (await backfillStatus.json())[0];

  console.log(`ERC1155 events in database: ${parseInt(backfillData.total_erc1155_events).toLocaleString()}`);
  console.log(`Unique transactions covered: ${parseInt(backfillData.unique_txs_with_events).toLocaleString()}`);
  console.log(`Total transactions needed: ${parseInt(backfillData.total_raw_txs).toLocaleString()}`);
  console.log(`Coverage: ${parseFloat(backfillData.coverage_pct).toFixed(1)}%\n`);

  if (parseFloat(backfillData.coverage_pct) < 95) {
    console.log('❌ Blockchain backfill is NOT complete yet.');
    console.log(`   Still need ${parseInt(backfillData.total_raw_txs) - parseInt(backfillData.unique_txs_with_events)} transactions (${(100 - parseFloat(backfillData.coverage_pct)).toFixed(1)}%)\n`);
  } else {
    console.log('✅ Blockchain backfill is complete! Ready for recovery.\n');
  }

  console.log('\n📊 FINAL VERDICT');
  console.log('='.repeat(80));

  if (gaps.length === 0) {
    console.log('✅ STATUS: trades_with_direction has 100% wallet coverage');
    console.log('✅ ACTION: Can calculate PnL metrics NOW');
    console.log('✅ ACCURACY: Win rate, omega ratio, ROI, PnL by category will be accurate');
    console.log('✅ BLOCKCHAIN BACKFILL: Can be stopped if running\n');
  } else if (parseInt(qualityData.has_valid_condition_id) > parseInt(qualityData.total_missing) * 0.95) {
    console.log('⚡ STATUS: Can recover from existing tables (>95% coverage)');
    console.log('⚡ ACTION: Build recovery query from vw_trades_canonical + trade_direction_assignments');
    console.log('⚡ TIME: 10-15 minutes');
    console.log('⚡ BLOCKCHAIN BACKFILL: Can be stopped - not needed\n');
  } else if (parseFloat(backfillData.coverage_pct) >= 95) {
    console.log('⚡ STATUS: Blockchain backfill is complete');
    console.log('⚡ ACTION: Extract condition_ids from erc1155_transfers');
    console.log('⚡ TIME: 10-15 minutes');
    console.log('✅ THEN: 100% wallet coverage achieved\n');
  } else {
    console.log('⏳ STATUS: Blockchain backfill in progress');
    console.log(`⏳ PROGRESS: ${parseFloat(backfillData.coverage_pct).toFixed(1)}% complete`);
    console.log('⏳ ACTION: Let backfill complete');
    console.log('⏳ THEN: Extract condition_ids and achieve 100% coverage\n');
  }

  await client.close();
}

completeDiagnostic().catch(console.error);
