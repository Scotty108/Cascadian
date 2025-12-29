#!/usr/bin/env npx tsx
/**
 * Build CTF-Active Tooltip Validation Cohort
 *
 * Creates a wallet cohort for tooltip validation that includes CTF-active edge cases.
 * These are wallets with PositionsMerge/Split events which historically cause
 * cash-flow formulas to diverge from synthetic valuation.
 *
 * Output: tmp/ui_tooltip_validation_ctf_30.json
 *
 * Usage: npx tsx scripts/pnl/build-tooltip-cohort-ctf-active.ts
 *
 * Terminal: Claude 1
 * Date: 2025-12-09
 */

import { createClient } from '@clickhouse/client';
import fs from 'fs';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 120000,
});

interface CTFWallet {
  wallet: string;
  mergeCount: number;
  mergeUsdc: number;
  splitCount: number;
  splitUsdc: number;
  clobEvents: number;
  payoutCount: number;
  payoutUsdc: number;
  totalActivity: number;
}

async function main() {
  console.log('='.repeat(80));
  console.log('BUILD CTF-ACTIVE TOOLTIP VALIDATION COHORT');
  console.log('='.repeat(80));
  console.log();

  // Query wallets with CTF activity
  // Target: 30 wallets with good spread of CTF activity
  const query = `
    SELECT
      lower(wallet_address) as wallet,
      countIf(source_type = 'PositionsMerge') as merge_count,
      round(sumIf(usdc_delta, source_type = 'PositionsMerge'), 2) as merge_usdc,
      countIf(source_type = 'PositionsSplit') as split_count,
      round(sumIf(usdc_delta, source_type = 'PositionsSplit'), 2) as split_usdc,
      countIf(source_type = 'CLOB') as clob_events,
      countIf(source_type = 'PayoutRedemption') as payout_count,
      round(sumIf(usdc_delta, source_type = 'PayoutRedemption'), 2) as payout_usdc,
      count(*) as total_activity
    FROM pm_unified_ledger_v8_tbl
    GROUP BY wallet_address
    HAVING
      -- Must have CTF activity (Merge or Split)
      (merge_count > 5 OR split_count > 5)
      -- Must have enough CLOB events to have meaningful PnL
      AND clob_events >= 50
      -- Not too many events (avoid Dome timeout)
      AND clob_events < 50000
      -- Must have some redemption activity
      AND payout_count > 0
      -- CTF USDC must be significant
      AND (abs(merge_usdc) > 1000 OR abs(split_usdc) > 1000)
    ORDER BY
      -- Prioritize wallets with both Merge and Split
      (merge_count > 0 AND split_count > 0) DESC,
      -- Then by merge activity
      merge_count DESC,
      -- Then by reasonable total activity
      clob_events ASC
    LIMIT 50
  `;

  console.log('Querying ClickHouse for CTF-active wallets...');

  const result = await client.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as CTFWallet[];

  console.log(`Found ${rows.length} candidate wallets\n`);

  // Select 30 wallets with good diversity
  // Bins: heavy-merge, heavy-split, both, moderate-merge
  const selected: CTFWallet[] = [];
  const bins = {
    heavyMerge: [] as CTFWallet[], // merge > 100, split < 10
    heavySplit: [] as CTFWallet[], // split > 100, merge < 10
    both: [] as CTFWallet[], // merge > 10 AND split > 10
    moderateMerge: [] as CTFWallet[], // merge 10-100
  };

  for (const wallet of rows) {
    const w = {
      ...wallet,
      mergeCount: Number(wallet.mergeCount),
      mergeUsdc: Number(wallet.mergeUsdc),
      splitCount: Number(wallet.splitCount),
      splitUsdc: Number(wallet.splitUsdc),
      clobEvents: Number(wallet.clobEvents),
      payoutCount: Number(wallet.payoutCount),
      payoutUsdc: Number(wallet.payoutUsdc),
      totalActivity: Number(wallet.totalActivity),
    };

    if (w.mergeCount > 10 && w.splitCount > 10) {
      bins.both.push(w);
    } else if (w.mergeCount > 100 && w.splitCount < 10) {
      bins.heavyMerge.push(w);
    } else if (w.splitCount > 100 && w.mergeCount < 10) {
      bins.heavySplit.push(w);
    } else if (w.mergeCount >= 10) {
      bins.moderateMerge.push(w);
    }
  }

  console.log('Bin distribution:');
  console.log(`  Heavy Merge:    ${bins.heavyMerge.length}`);
  console.log(`  Heavy Split:    ${bins.heavySplit.length}`);
  console.log(`  Both:           ${bins.both.length}`);
  console.log(`  Moderate Merge: ${bins.moderateMerge.length}`);
  console.log();

  // Select from each bin to get diversity
  const targetPerBin = {
    both: 12,
    heavyMerge: 8,
    moderateMerge: 6,
    heavySplit: 4,
  };

  for (const w of bins.both.slice(0, targetPerBin.both)) selected.push(w);
  for (const w of bins.heavyMerge.slice(0, targetPerBin.heavyMerge)) selected.push(w);
  for (const w of bins.moderateMerge.slice(0, targetPerBin.moderateMerge)) selected.push(w);
  for (const w of bins.heavySplit.slice(0, targetPerBin.heavySplit)) selected.push(w);

  // If still short, add from largest bin
  if (selected.length < 30) {
    const all = [...bins.both, ...bins.heavyMerge, ...bins.moderateMerge, ...bins.heavySplit];
    for (const w of all) {
      if (selected.length >= 30) break;
      if (!selected.find((s) => s.wallet === w.wallet)) {
        selected.push(w);
      }
    }
  }

  console.log(`Selected ${selected.length} wallets for tooltip cohort\n`);

  // Build output with schema_version
  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      source: 'clickhouse_ctf_active_cohort',
      schema_version: '2.0',
      wallet_count: selected.length,
      purpose: 'UI tooltip validation with CTF edge cases',
      selection_criteria: {
        merge_or_split_events: '>= 5',
        clob_events: '50-50000',
        payout_events: '> 0',
        ctf_usdc_threshold: '$1000',
      },
      bin_allocation: {
        both_merge_and_split: selected.filter(
          (w) => Number(w.mergeCount) > 10 && Number(w.splitCount) > 10
        ).length,
        heavy_merge_only: selected.filter(
          (w) => Number(w.mergeCount) > 100 && Number(w.splitCount) < 10
        ).length,
        moderate_merge: selected.filter(
          (w) =>
            Number(w.mergeCount) >= 10 &&
            Number(w.mergeCount) <= 100 &&
            Number(w.splitCount) < 10
        ).length,
        heavy_split_only: selected.filter(
          (w) => Number(w.splitCount) > 100 && Number(w.mergeCount) < 10
        ).length,
      },
    },
    wallets: selected.map((w, i) => ({
      wallet: w.wallet,
      index: i + 1,
      ctf_profile: {
        merge_count: Number(w.mergeCount),
        merge_usdc: Number(w.mergeUsdc),
        split_count: Number(w.splitCount),
        split_usdc: Number(w.splitUsdc),
      },
      activity: {
        clob_events: Number(w.clobEvents),
        payout_count: Number(w.payoutCount),
        payout_usdc: Number(w.payoutUsdc),
        total_activity: Number(w.totalActivity),
      },
      label: classifyWallet(w),
    })),
  };

  // Also create a simple list for the scraper
  const scraperInput = {
    metadata: {
      generated_at: new Date().toISOString(),
      source: 'ctf_active_cohort',
      schema_version: '2.0',
      wallet_count: selected.length,
    },
    wallets: selected.map((w, i) => ({
      wallet: w.wallet,
      bin: classifyWallet(w),
      mergeCount: Number(w.mergeCount),
      splitCount: Number(w.splitCount),
    })),
  };

  // Write outputs
  const detailedPath = 'tmp/ui_tooltip_validation_ctf_30.json';
  const scraperPath = 'tmp/tooltip_candidates_ctf_30.json';

  fs.writeFileSync(detailedPath, JSON.stringify(output, null, 2));
  fs.writeFileSync(scraperPath, JSON.stringify(scraperInput, null, 2));

  console.log('='.repeat(80));
  console.log('OUTPUT');
  console.log('='.repeat(80));
  console.log(`Detailed:     ${detailedPath}`);
  console.log(`Scraper input: ${scraperPath}`);
  console.log();

  // Print summary table
  console.log('Wallet                                    | Merge | Split | CLOB   | Type');
  console.log('-'.repeat(80));
  for (const w of selected.slice(0, 15)) {
    const type = classifyWallet(w);
    console.log(
      `${w.wallet} | ${String(w.mergeCount).padStart(5)} | ${String(w.splitCount).padStart(5)} | ${String(w.clobEvents).padStart(6)} | ${type}`
    );
  }
  if (selected.length > 15) {
    console.log(`... and ${selected.length - 15} more wallets`);
  }

  await client.close();
  console.log('\nDone.');
}

function classifyWallet(w: CTFWallet): string {
  const m = Number(w.mergeCount);
  const s = Number(w.splitCount);

  if (m > 10 && s > 10) return 'both-ctf';
  if (m > 100) return 'heavy-merge';
  if (s > 100) return 'heavy-split';
  if (m >= 10) return 'moderate-merge';
  if (s >= 10) return 'moderate-split';
  return 'light-ctf';
}

main().catch(console.error);
