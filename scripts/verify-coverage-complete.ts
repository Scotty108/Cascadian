#!/usr/bin/env npx tsx

/**
 * PHASE 4: Verify Coverage Completeness
 *
 * Comprehensive coverage verification after backfill merge:
 * 1. Global coverage metrics (≥95% threshold)
 * 2. Per-wallet coverage for baseline wallets
 * 3. Identify remaining gaps (if any)
 * 4. Provide recommendations for next steps
 *
 * Usage: npx tsx scripts/verify-coverage-complete.ts
 *
 * Expected runtime: ~30 seconds
 */

import { clickhouse } from '../lib/clickhouse/client.js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const BASELINE_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═'.repeat(80));
  console.log('PHASE 4: COVERAGE VERIFICATION');
  console.log('═'.repeat(80));
  console.log();

  // 1. Global coverage metrics
  console.log('[1] Global Coverage Metrics');
  console.log('─'.repeat(80));

  const globalResult = await clickhouse.query({
    query: `
      SELECT
        uniq(asset_id) as total_asset_ids,
        uniqIf(asset_id, token_id IS NOT NULL) as mapped_asset_ids
      FROM clob_fills cf
      LEFT JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
    `,
    format: 'JSONEachRow'
  });
  const global = (await globalResult.json())[0];

  const globalCoverage = (parseInt(global.mapped_asset_ids) / parseInt(global.total_asset_ids) * 100).toFixed(2);
  const unmapped = parseInt(global.total_asset_ids) - parseInt(global.mapped_asset_ids);

  console.log(`Total unique asset_ids in CLOB fills:  ${parseInt(global.total_asset_ids).toLocaleString()}`);
  console.log(`Mapped in ctf_token_map:                ${parseInt(global.mapped_asset_ids).toLocaleString()}`);
  console.log(`Unmapped:                               ${unmapped.toLocaleString()}`);
  console.log();
  console.log(`Coverage: ${globalCoverage}%`);
  console.log();

  const globalPass = parseFloat(globalCoverage) >= 95.0;
  console.log(globalPass ? '✅ Global coverage ≥95%' : `❌ Global coverage <95% (gap: ${(95.0 - parseFloat(globalCoverage)).toFixed(2)}%)`);
  console.log();

  // 2. Baseline wallet coverage
  console.log('[2] Baseline Wallet Coverage');
  console.log('─'.repeat(80));
  console.log(`Wallet: ${BASELINE_WALLET}`);
  console.log();

  const walletResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_fills,
        COUNTIf(token_id IS NOT NULL) as mapped_fills
      FROM clob_fills cf
      LEFT JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
      WHERE lower(cf.proxy_wallet) = lower('${BASELINE_WALLET}')
    `,
    format: 'JSONEachRow'
  });
  const wallet = (await walletResult.json())[0];

  const walletCoverage = (parseInt(wallet.mapped_fills) / parseInt(wallet.total_fills) * 100).toFixed(2);
  const walletUnmapped = parseInt(wallet.total_fills) - parseInt(wallet.mapped_fills);

  console.log(`Total fills:   ${parseInt(wallet.total_fills).toLocaleString()}`);
  console.log(`Mapped fills:  ${parseInt(wallet.mapped_fills).toLocaleString()}`);
  console.log(`Unmapped:      ${walletUnmapped.toLocaleString()}`);
  console.log();
  console.log(`Coverage: ${walletCoverage}%`);
  console.log();

  const walletPass = parseFloat(walletCoverage) >= 95.0;
  console.log(walletPass ? '✅ Baseline wallet coverage ≥95%' : `⚠️  Baseline wallet coverage <95% (gap: ${(95.0 - parseFloat(walletCoverage)).toFixed(2)}%)`);
  console.log();

  // 3. Available positions for P&L calculation
  console.log('[3] Available P&L Positions');
  console.log('─'.repeat(80));

  const positionsResult = await clickhouse.query({
    query: `
      SELECT COUNT(*) as position_count
      FROM (
        SELECT
          cf.proxy_wallet,
          lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
          ctm.outcome_index AS outcome_idx
        FROM clob_fills cf
        INNER JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
        INNER JOIN gamma_resolved gr ON lower(replaceAll(cf.condition_id, '0x', '')) = gr.cid
        WHERE lower(cf.proxy_wallet) = lower('${BASELINE_WALLET}')
          AND cf.condition_id IS NOT NULL
          AND cf.condition_id != ''
        GROUP BY proxy_wallet, condition_id_norm, outcome_idx
      )
    `,
    format: 'JSONEachRow'
  });
  const positions = (await positionsResult.json())[0];

  console.log(`Resolved positions available: ${parseInt(positions.position_count).toLocaleString()}`);
  console.log();

  const positionsPass = parseInt(positions.position_count) >= 50;
  console.log(positionsPass ? '✅ Sufficient positions for P&L validation (≥50)' : `⚠️  Low position count (<50) - may affect validation accuracy`);
  console.log();

  // 4. Sample unmapped tokens (if any)
  if (unmapped > 0) {
    console.log('[4] Sample Unmapped Tokens');
    console.log('─'.repeat(80));

    const samplesResult = await clickhouse.query({
      query: `
        SELECT DISTINCT cf.asset_id
        FROM clob_fills cf
        LEFT JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
        WHERE ctm.token_id IS NULL
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const samples = await samplesResult.json();

    console.log('First 10 unmapped asset_ids:');
    samples.forEach((row: any, idx: number) => {
      console.log(`  ${(idx + 1).toString().padStart(2)}. ${row.asset_id.substring(0, 32)}...`);
    });
    console.log();
  }

  // 5. Final verdict
  console.log('═'.repeat(80));
  console.log('FINAL VERDICT');
  console.log('═'.repeat(80));
  console.log();

  const allPass = globalPass && walletPass && positionsPass;

  if (allPass) {
    console.log('✅ ALL CHECKS PASSED');
    console.log();
    console.log('Coverage verification complete:');
    console.log(`  ✅ Global coverage: ${globalCoverage}% (≥95%)  `);
    console.log(`  ✅ Baseline wallet: ${walletCoverage}% (≥95%)`);
    console.log(`  ✅ P&L positions:   ${parseInt(positions.position_count).toLocaleString()} (≥50)`);
    console.log();
    console.log('System is ready for Phase 5: P&L Validation');
    console.log();
    console.log('Next step:');
    console.log('  npx tsx scripts/validate-corrected-pnl-comprehensive.ts');
  } else {
    console.log('⚠️  SOME CHECKS FAILED');
    console.log();
    console.log('Coverage verification results:');
    console.log(`  ${globalPass ? '✅' : '❌'} Global coverage: ${globalCoverage}% (target: ≥95%)`);
    console.log(`  ${walletPass ? '✅' : '⚠️ '} Baseline wallet: ${walletCoverage}% (target: ≥95%)`);
    console.log(`  ${positionsPass ? '✅' : '⚠️ '} P&L positions:   ${parseInt(positions.position_count).toLocaleString()} (target: ≥50)`);
    console.log();

    if (!globalPass) {
      console.log('Recommendation:');
      console.log('  • Global coverage below 95% threshold');
      console.log('  • Consider running additional backfill iterations');
      console.log('  • Or proceed with validation (may have slightly higher variance)');
    } else if (!walletPass || !positionsPass) {
      console.log('Recommendation:');
      console.log('  • Global coverage is good, but baseline wallet coverage is low');
      console.log('  • This may indicate wallet-specific gaps (e.g., old/rare tokens)');
      console.log('  • Safe to proceed with validation, but variance may be >2%');
    }
  }

  console.log('═'.repeat(80));
}

main().catch(console.error);
