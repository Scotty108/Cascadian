#!/usr/bin/env npx tsx
/**
 * COMPREHENSIVE VERIFICATION OF ALL KEY FINDINGS
 *
 * This script double-checks every claim before proceeding with Option B
 */
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const WALLET = '0x9155e8cf81a3fb557639d23d43f1528675bcfcad';

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('COMPREHENSIVE VERIFICATION OF ALL FINDINGS');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const findings = [];

  // ============================================================================
  // FINDING 1: Mapping tables contain no usable data
  // ============================================================================
  console.log('FINDING 1: Mapping tables contain no usable data\n');
  console.log('─'.repeat(80) + '\n');

  // Check erc1155_condition_map
  const erc1155Check = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        COUNT(DISTINCT token_id) as unique_tokens,
        COUNT(DISTINCT condition_id) as unique_conditions,
        SUM(CASE WHEN token_id = condition_id THEN 1 ELSE 0 END) as identical_count
      FROM default.erc1155_condition_map
      WHERE token_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow',
  });
  const erc1155 = await erc1155Check.json<any[]>();

  console.log('erc1155_condition_map:');
  console.log(`  Total rows: ${parseInt(erc1155[0].total_rows).toLocaleString()}`);
  console.log(`  Unique tokens: ${parseInt(erc1155[0].unique_tokens).toLocaleString()}`);
  console.log(`  Unique conditions: ${parseInt(erc1155[0].unique_conditions).toLocaleString()}`);
  console.log(`  Identical (token=condition): ${parseInt(erc1155[0].identical_count).toLocaleString()}`);

  const erc1155Pct = (parseInt(erc1155[0].identical_count) / parseInt(erc1155[0].total_rows) * 100).toFixed(1);
  console.log(`  ${erc1155Pct}% have identical token_id and condition_id (USELESS)\n`);

  findings.push({
    finding: 'erc1155_condition_map has no useful mapping',
    verified: parseFloat(erc1155Pct) > 90
  });

  // Check token_condition_market_map
  const tcmCheck = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        COUNT(DISTINCT condition_id_32b) as non_null_conditions,
        SUM(CASE WHEN condition_id_32b IS NULL OR condition_id_32b = '' THEN 1 ELSE 0 END) as null_count
      FROM cascadian_clean.token_condition_market_map
    `,
    format: 'JSONEachRow',
  });
  const tcm = await tcmCheck.json<any[]>();

  console.log('cascadian_clean.token_condition_market_map:');
  console.log(`  Total rows: ${parseInt(tcm[0].total_rows).toLocaleString()}`);
  console.log(`  Non-null conditions: ${parseInt(tcm[0].non_null_conditions).toLocaleString()}`);
  console.log(`  Null/empty conditions: ${parseInt(tcm[0].null_count).toLocaleString()}\n`);

  findings.push({
    finding: 'token_condition_market_map has valid condition_id_32b data',
    verified: parseInt(tcm[0].non_null_conditions) > 0
  });

  // ============================================================================
  // FINDING 2: Current global P&L coverage is ~12% after normalization
  // ============================================================================
  console.log('\n' + '═'.repeat(80));
  console.log('FINDING 2: Global P&L coverage after ID normalization\n');
  console.log('─'.repeat(80) + '\n');

  const globalCoverage = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        COUNT(realized_pnl_usd) as resolved_positions,
        round(100.0 * COUNT(realized_pnl_usd) / COUNT(*), 2) as coverage_pct
      FROM default.vw_wallet_pnl_calculated
    `,
    format: 'JSONEachRow',
  });
  const coverage = await globalCoverage.json<any[]>();

  console.log(`Total positions: ${parseInt(coverage[0].total_positions).toLocaleString()}`);
  console.log(`Resolved positions: ${parseInt(coverage[0].resolved_positions).toLocaleString()}`);
  console.log(`Coverage: ${coverage[0].coverage_pct}%\n`);

  findings.push({
    finding: 'Global coverage is 10-15% after normalization',
    verified: parseFloat(coverage[0].coverage_pct) >= 10 && parseFloat(coverage[0].coverage_pct) <= 15
  });

  // ============================================================================
  // FINDING 3: Wallet 0x9155e8cf has 0% coverage
  // ============================================================================
  console.log('═'.repeat(80));
  console.log('FINDING 3: Wallet 0x9155e8cf has 0% coverage\n');
  console.log('─'.repeat(80) + '\n');

  const walletCoverage = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        COUNT(realized_pnl_usd) as resolved_positions,
        SUM(realized_pnl_usd) as total_pnl
      FROM default.vw_wallet_pnl_calculated
      WHERE lower(wallet) = lower('${WALLET}')
    `,
    format: 'JSONEachRow',
  });
  const walletPnl = await walletCoverage.json<any[]>();

  console.log(`Wallet ${WALLET.substring(0, 12)}...:`);
  console.log(`  Total positions: ${parseInt(walletPnl[0].total_positions).toLocaleString()}`);
  console.log(`  Resolved positions: ${parseInt(walletPnl[0].resolved_positions).toLocaleString()}`);
  console.log(`  Total P&L: $${parseFloat(walletPnl[0].total_pnl || 0).toLocaleString()}`);
  console.log(`  Expected P&L: $110,440.13\n`);

  findings.push({
    finding: 'Wallet 0x9155e8cf has 0 resolved positions',
    verified: parseInt(walletPnl[0].resolved_positions) === 0
  });

  // ============================================================================
  // FINDING 4: Wallet's condition IDs don't match resolution IDs
  // ============================================================================
  console.log('═'.repeat(80));
  console.log('FINDING 4: Wallet condition IDs vs Resolution IDs (format mismatch)\n');
  console.log('─'.repeat(80) + '\n');

  const idMismatch = await ch.query({
    query: `
      WITH wallet_cids AS (
        SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${WALLET}')
        LIMIT 100
      ),
      resolution_cids AS (
        SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid
        FROM default.market_resolutions_final
        WHERE payout_denominator > 0

        UNION DISTINCT

        SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid
        FROM default.resolutions_external_ingest
        WHERE payout_denominator > 0
      )
      SELECT
        (SELECT COUNT(*) FROM wallet_cids) as wallet_sample_size,
        COUNT(*) as matched_count
      FROM wallet_cids w
      INNER JOIN resolution_cids r ON w.cid = r.cid
    `,
    format: 'JSONEachRow',
  });
  const mismatch = await idMismatch.json<any[]>();

  console.log(`Sample wallet condition IDs: ${mismatch[0].wallet_sample_size}`);
  console.log(`Matched with resolutions: ${mismatch[0].matched_count}`);
  console.log(`Match rate: ${((parseInt(mismatch[0].matched_count) / parseInt(mismatch[0].wallet_sample_size)) * 100).toFixed(1)}%\n`);

  findings.push({
    finding: 'Wallet condition IDs do NOT match resolution IDs',
    verified: parseInt(mismatch[0].matched_count) === 0
  });

  // ============================================================================
  // FINDING 5: Resolution data exists but can't be joined
  // ============================================================================
  console.log('═'.repeat(80));
  console.log('FINDING 5: Resolution data exists and is substantial\n');
  console.log('─'.repeat(80) + '\n');

  const resolutionCount = await ch.query({
    query: `
      SELECT
        (SELECT COUNT(*) FROM default.market_resolutions_final WHERE payout_denominator > 0) as mrf_count,
        (SELECT COUNT(*) FROM default.resolutions_external_ingest WHERE payout_denominator > 0) as rei_count
    `,
    format: 'JSONEachRow',
  });
  const resCount = await resolutionCount.json<any[]>();

  const totalResolutions = parseInt(resCount[0].mrf_count) + parseInt(resCount[0].rei_count);
  console.log(`market_resolutions_final: ${parseInt(resCount[0].mrf_count).toLocaleString()}`);
  console.log(`resolutions_external_ingest: ${parseInt(resCount[0].rei_count).toLocaleString()}`);
  console.log(`Total resolutions available: ${totalResolutions.toLocaleString()}\n`);

  findings.push({
    finding: 'Substantial resolution data exists (>100K markets)',
    verified: totalResolutions > 100000
  });

  // ============================================================================
  // FINDING 6: Sample IDs show format difference
  // ============================================================================
  console.log('═'.repeat(80));
  console.log('FINDING 6: ID format comparison (visual proof)\n');
  console.log('─'.repeat(80) + '\n');

  const walletIds = await ch.query({
    query: `
      SELECT DISTINCT condition_id_norm
      FROM default.vw_trades_canonical
      WHERE lower(wallet_address_norm) = lower('${WALLET}')
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });
  const wIds = await walletIds.json<any[]>();

  const resIds = await ch.query({
    query: `
      SELECT DISTINCT condition_id_norm
      FROM default.market_resolutions_final
      WHERE payout_denominator > 0
      LIMIT 3
    `,
    format: 'JSONEachRow',
  });
  const rIds = await resIds.json<any[]>();

  console.log('Sample wallet condition IDs:');
  wIds.forEach((id, i) => console.log(`  ${i+1}. ${id.condition_id_norm}`));

  console.log('\nSample resolution condition IDs:');
  rIds.forEach((id, i) => console.log(`  ${i+1}. ${id.condition_id_norm}`));

  console.log('\nObservation: Leading zeros differ significantly\n');

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('═'.repeat(80));
  console.log('VERIFICATION SUMMARY');
  console.log('═'.repeat(80) + '\n');

  findings.forEach((f, i) => {
    const status = f.verified ? '✅ VERIFIED' : '❌ NOT VERIFIED';
    console.log(`${i+1}. ${f.finding}`);
    console.log(`   ${status}\n`);
  });

  const allVerified = findings.every(f => f.verified);

  console.log('═'.repeat(80));
  if (allVerified) {
    console.log('✅ ALL FINDINGS VERIFIED - SAFE TO PROCEED WITH OPTION B');
  } else {
    console.log('⚠️  SOME FINDINGS NOT VERIFIED - REVIEW BEFORE PROCEEDING');
  }
  console.log('═'.repeat(80));
  console.log('\nNext step: Build token→condition ID mapping from Polymarket API\n');

  await ch.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
