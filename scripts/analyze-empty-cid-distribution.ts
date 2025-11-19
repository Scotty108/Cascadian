#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

// Task 2: Quantify empty cid_norm rows and park for C2/C3 investigation

async function main() {
  console.log('═'.repeat(80));
  console.log('EMPTY CID TRIAGE ANALYSIS');
  console.log('═'.repeat(80));
  console.log('');

  try {
    // 1. Overall empty CID statistics
    console.log('PART 1: Overall Statistics');
    console.log('─'.repeat(80));

    const overallQuery = `
      SELECT
        count() AS total_trades,
        countIf(cid_norm IS NULL OR cid_norm = '') AS empty_cid_count,
        countIf(wallet_canonical IS NULL) AS null_wallet_count,
        countIf(wallet_canonical = '') AS empty_wallet_count,
        round(empty_cid_count / total_trades * 100, 2) AS empty_cid_pct
      FROM vw_trades_canonical_with_canonical_wallet
    `;

    const overallResult = await clickhouse.query({ query: overallQuery, format: 'JSONEachRow' });
    const overallData = await overallResult.json() as any[];

    const stats = overallData[0];
    console.log(`  Total trades:              ${parseInt(stats.total_trades).toLocaleString()}`);
    console.log(`  Empty CID count:           ${parseInt(stats.empty_cid_count).toLocaleString()} (${stats.empty_cid_pct}%)`);
    console.log(`  NULL wallet_canonical:     ${parseInt(stats.null_wallet_count).toLocaleString()}`);
    console.log(`  Empty wallet_canonical:    ${parseInt(stats.empty_wallet_count).toLocaleString()}`);
    console.log('');

    // 2. Empty CID by wallet (top 20)
    console.log('PART 2: Top 20 Wallets with Empty CID');
    console.log('─'.repeat(80));

    const walletQuery = `
      SELECT
        wallet_canonical,
        countIf(cid_norm IS NULL OR cid_norm = '') AS empty_cid_count,
        count() AS total_trades,
        round(empty_cid_count / total_trades * 100, 2) AS empty_pct,
        sum(usd_value) AS total_volume_usd
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE cid_norm IS NULL OR cid_norm = ''
      GROUP BY wallet_canonical
      ORDER BY empty_cid_count DESC
      LIMIT 20
    `;

    const walletResult = await clickhouse.query({ query: walletQuery, format: 'JSONEachRow' });
    const walletData = await walletResult.json() as any[];

    console.log('Wallet Address                               Empty CID    Total Trades  Empty %   Volume (USD)');
    console.log('─'.repeat(100));

    for (const row of walletData) {
      const wallet = row.wallet_canonical || '(empty)';
      const walletDisplay = wallet === '(empty)' ? '(empty)'.padEnd(42) : `${wallet.substring(0, 6)}...${wallet.substring(36)}`.padEnd(42);
      const emptyCid = parseInt(row.empty_cid_count).toLocaleString().padStart(12);
      const totalTrades = parseInt(row.total_trades).toLocaleString().padStart(13);
      const emptyPct = parseFloat(row.empty_pct).toFixed(2).padStart(7);
      const volume = parseFloat(row.total_volume_usd).toLocaleString('en-US', { maximumFractionDigits: 2 }).padStart(15);

      console.log(`${walletDisplay} ${emptyCid} ${totalTrades} ${emptyPct}% ${volume}`);
    }
    console.log('');

    // 3. Empty CID by month
    console.log('PART 3: Empty CID Distribution by Month');
    console.log('─'.repeat(80));

    const monthQuery = `
      SELECT
        toYYYYMM(timestamp) AS month_yyyymm,
        countIf(cid_norm IS NULL OR cid_norm = '') AS empty_cid_count,
        count() AS total_trades,
        round(empty_cid_count / total_trades * 100, 2) AS empty_pct
      FROM vw_trades_canonical_with_canonical_wallet
      GROUP BY month_yyyymm
      ORDER BY month_yyyymm DESC
      LIMIT 24
    `;

    const monthResult = await clickhouse.query({ query: monthQuery, format: 'JSONEachRow' });
    const monthData = await monthResult.json() as any[];

    console.log('Month       Empty CID    Total Trades  Empty %');
    console.log('─'.repeat(60));

    for (const row of monthData) {
      const month = row.month_yyyymm.toString();
      const monthDisplay = `${month.substring(0, 4)}-${month.substring(4)}`.padEnd(10);
      const emptyCid = parseInt(row.empty_cid_count).toLocaleString().padStart(12);
      const totalTrades = parseInt(row.total_trades).toLocaleString().padStart(13);
      const emptyPct = parseFloat(row.empty_pct).toFixed(2).padStart(7);

      console.log(`${monthDisplay} ${emptyCid} ${totalTrades} ${emptyPct}%`);
    }
    console.log('');

    // 4. Sample empty CID trades for pattern analysis
    console.log('PART 4: Sample Empty CID Trades (10 samples)');
    console.log('─'.repeat(80));

    const sampleQuery = `
      SELECT
        wallet_canonical,
        wallet_raw,
        timestamp,
        usd_value,
        shares,
        trade_direction,
        transaction_hash,
        condition_id_norm_v3
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE cid_norm IS NULL OR cid_norm = ''
      ORDER BY timestamp DESC
      LIMIT 10
    `;

    const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
    const sampleData = await sampleResult.json() as any[];

    console.log('');
    for (let i = 0; i < sampleData.length; i++) {
      const row = sampleData[i];
      console.log(`Sample ${i + 1}:`);
      console.log(`  Wallet (canonical): ${row.wallet_canonical || '(empty)'}`);
      console.log(`  Wallet (raw):       ${row.wallet_raw || '(empty)'}`);
      console.log(`  Timestamp:          ${row.timestamp}`);
      console.log(`  USD Value:          $${parseFloat(row.usd_value).toFixed(2)}`);
      console.log(`  Direction:          ${row.trade_direction}`);
      console.log(`  CID (raw):          ${row.condition_id_norm_v3 || '(empty)'}`);
      console.log(`  TX Hash:            ${row.transaction_hash || '(empty)'}`);
      console.log('');
    }

    // 5. Create temp view for C2/C3
    console.log('PART 5: Creating Temporary View for C2/C3');
    console.log('─'.repeat(80));

    const createViewQuery = `
      CREATE OR REPLACE VIEW vw_trades_empty_cid AS
      SELECT
        *,
        'empty_cid' AS triage_reason
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE cid_norm IS NULL OR cid_norm = ''
    `;

    await clickhouse.query({ query: createViewQuery });
    console.log('✅ Created view: vw_trades_empty_cid');
    console.log('');

    // Verify view creation
    const verifyQuery = `SELECT count() AS row_count FROM vw_trades_empty_cid`;
    const verifyResult = await clickhouse.query({ query: verifyQuery, format: 'JSONEachRow' });
    const verifyData = await verifyResult.json() as any[];

    console.log(`✅ View contains ${parseInt(verifyData[0].row_count).toLocaleString()} rows`);
    console.log('');

    // 6. Pattern summary
    console.log('PART 6: Pattern Summary for C2/C3');
    console.log('─'.repeat(80));
    console.log('');
    console.log('Key Observations:');
    console.log('');
    console.log('1. Root Cause Analysis:');
    console.log('   - Empty CID values likely stem from missing condition_id_norm_v3 in base table');
    console.log('   - Need to investigate pm_trades_canonical_v3 source data quality');
    console.log('');
    console.log('2. Empty Wallet Canonical:');
    console.log(`   - ${parseInt(stats.empty_wallet_count).toLocaleString()} trades have empty wallet_canonical`);
    console.log('   - This occurs when wallet_address is empty/NULL in base table');
    console.log('   - Coalesce falls through to lower(t.wallet_address) which becomes empty string');
    console.log('');
    console.log('3. Recommended Actions for C2/C3:');
    console.log('   a) Investigate pm_trades_canonical_v3 data pipeline for missing CIDs');
    console.log('   b) Check if these are partial/failed transactions');
    console.log('   c) Determine if these should be filtered out or backfilled');
    console.log('   d) Add data quality guardrails to prevent future empty CIDs');
    console.log('');
    console.log('4. Impact on Current Work:');
    console.log('   - Empty CID rows cannot be attributed to markets (no condition_id)');
    console.log('   - These are excluded from PnL calculations automatically');
    console.log('   - vw_trades_clean_global already filters these out');
    console.log('   - Wallet canonicalization NOT affected (separate issue)');
    console.log('');

    console.log('═'.repeat(80));
    console.log('✅ EMPTY CID TRIAGE COMPLETE');
    console.log('═'.repeat(80));
    console.log('');
    console.log('Deliverables:');
    console.log('  1. Statistical analysis (above)');
    console.log('  2. View created: vw_trades_empty_cid (for C2/C3 investigation)');
    console.log('  3. Pattern documentation (above)');
    console.log('');

  } catch (error: any) {
    console.error('❌ ERROR:', error.message);
    console.error('');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
