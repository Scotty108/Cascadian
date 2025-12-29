/**
 * Phase 1: Identify wallets with unmapped tokens
 *
 * For each wallet in the copy trading cohort:
 * 1. Get all tokens they've traded
 * 2. Check mapping coverage (Gamma + patch table)
 * 3. Flag wallets with <100% coverage
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

async function main() {
  console.log('=== PHASE 1: IDENTIFY UNMAPPED WALLETS ===\n');

  // Step 1: Get all wallets from cohort
  const walletQ = `
    SELECT DISTINCT wallet
    FROM pm_copytrade_candidates_v4
    ORDER BY wallet
  `;
  const walletR = await clickhouse.query({ query: walletQ, format: 'JSONEachRow' });
  const wallets = (await walletR.json() as any[]).map(w => w.wallet);
  console.log(`Found ${wallets.length} wallets in cohort\n`);

  // Step 2: For each wallet, check token coverage
  const results: Array<{
    wallet: string;
    total_tokens: number;
    gamma_mapped: number;
    patch_mapped: number;
    unmapped: number;
    coverage_pct: number;
  }> = [];

  // Process in batches for efficiency
  const BATCH_SIZE = 50;
  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);
    const walletList = batch.map(w => `'${w}'`).join(',');

    const coverageQ = `
      WITH wallet_tokens AS (
        SELECT
          trader_wallet,
          token_id
        FROM pm_trader_events_v2
        WHERE trader_wallet IN (${walletList})
          AND is_deleted = 0
        GROUP BY trader_wallet, token_id
      ),
      gamma_coverage AS (
        SELECT
          wt.trader_wallet,
          wt.token_id,
          if(g.token_id_dec != '', 1, 0) as gamma_mapped
        FROM wallet_tokens wt
        LEFT JOIN pm_token_to_condition_map_v5 g ON wt.token_id = g.token_id_dec
      ),
      patch_coverage AS (
        SELECT
          wt.trader_wallet,
          wt.token_id,
          if(p.token_id_dec != '', 1, 0) as patch_mapped
        FROM wallet_tokens wt
        LEFT JOIN pm_token_to_condition_patch p ON wt.token_id = p.token_id_dec
      )
      SELECT
        g.trader_wallet as wallet,
        count() as total_tokens,
        sum(g.gamma_mapped) as gamma_mapped,
        sum(p.patch_mapped) as patch_mapped,
        sum(if(g.gamma_mapped = 0 AND p.patch_mapped = 0, 1, 0)) as unmapped
      FROM gamma_coverage g
      JOIN patch_coverage p ON g.trader_wallet = p.trader_wallet AND g.token_id = p.token_id
      GROUP BY g.trader_wallet
    `;

    const coverageR = await clickhouse.query({ query: coverageQ, format: 'JSONEachRow' });
    const coverage = await coverageR.json() as any[];

    for (const c of coverage) {
      const total = parseInt(c.total_tokens);
      const unmapped = parseInt(c.unmapped);
      results.push({
        wallet: c.wallet,
        total_tokens: total,
        gamma_mapped: parseInt(c.gamma_mapped),
        patch_mapped: parseInt(c.patch_mapped),
        unmapped: unmapped,
        coverage_pct: ((total - unmapped) / total) * 100
      });
    }

    console.log(`Processed ${Math.min(i + BATCH_SIZE, wallets.length)}/${wallets.length} wallets...`);
  }

  // Step 3: Analyze results
  const fullyMapped = results.filter(r => r.unmapped === 0);
  const partiallyMapped = results.filter(r => r.unmapped > 0 && r.coverage_pct >= 50);
  const poorlyMapped = results.filter(r => r.coverage_pct < 50);

  console.log('\n=== COVERAGE SUMMARY ===');
  console.log(`Fully mapped (100%): ${fullyMapped.length} wallets`);
  console.log(`Partially mapped (50-99%): ${partiallyMapped.length} wallets`);
  console.log(`Poorly mapped (<50%): ${poorlyMapped.length} wallets`);

  // Step 4: Export results
  let csv = 'wallet,total_tokens,gamma_mapped,patch_mapped,unmapped,coverage_pct\n';
  for (const r of results.sort((a, b) => a.coverage_pct - b.coverage_pct)) {
    csv += `${r.wallet},${r.total_tokens},${r.gamma_mapped},${r.patch_mapped},${r.unmapped},${r.coverage_pct.toFixed(1)}\n`;
  }
  fs.writeFileSync('exports/phase1_wallet_coverage.csv', csv);
  console.log(`\nExported to exports/phase1_wallet_coverage.csv`);

  // Step 5: Show wallets needing work
  const needsWork = results.filter(r => r.unmapped > 0).sort((a, b) => b.unmapped - a.unmapped);

  console.log(`\n=== WALLETS NEEDING MAPPING (${needsWork.length}) ===`);
  console.log('Wallet                                     | Total | Unmapped | Coverage');
  console.log('-'.repeat(80));

  for (const r of needsWork.slice(0, 20)) {
    console.log(`${r.wallet} | ${r.total_tokens.toString().padStart(5)} | ${r.unmapped.toString().padStart(8)} | ${r.coverage_pct.toFixed(1)}%`);
  }

  if (needsWork.length > 20) {
    console.log(`... and ${needsWork.length - 20} more`);
  }

  // Step 6: Count unique unmapped tokens across all wallets
  const unmappedTokensQ = `
    WITH all_tokens AS (
      SELECT DISTINCT token_id
      FROM pm_trader_events_v2
      WHERE trader_wallet IN (${wallets.map(w => `'${w}'`).join(',')})
        AND is_deleted = 0
    ),
    mapped_tokens AS (
      SELECT token_id_dec as token_id FROM pm_token_to_condition_map_v5
      UNION ALL
      SELECT token_id_dec as token_id FROM pm_token_to_condition_patch
    )
    SELECT count() as unmapped_count
    FROM all_tokens a
    LEFT JOIN mapped_tokens m ON a.token_id = m.token_id
    WHERE m.token_id IS NULL OR m.token_id = ''
  `;
  const unmappedTokensR = await clickhouse.query({ query: unmappedTokensQ, format: 'JSONEachRow' });
  const { unmapped_count } = (await unmappedTokensR.json() as any[])[0];

  console.log(`\n=== UNIQUE UNMAPPED TOKENS ===`);
  console.log(`Total unique unmapped tokens across cohort: ${unmapped_count}`);
}

main().catch(console.error);
