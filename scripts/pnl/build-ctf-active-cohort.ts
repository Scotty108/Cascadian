/**
 * Build CTF-Active Validation Cohort
 *
 * Creates a cohort of wallets with CTF activity (PositionsMerge/PositionSplit)
 * for testing differentiation between V12CashFull and V12DomeCash.
 *
 * Selection criteria:
 * - positions_merge_count > 0 OR positions_split_count > 0
 * - amm_event_count = 0 (CLOB traders, not AMM)
 * - transfer_dominance < 5% (not transfer-heavy)
 * - clob_event_count >= 50 (meaningful activity)
 */

import { createClient } from '@clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 120000,
});

interface WalletStats {
  wallet: string;
  clob_events: number;
  merge_events: number;
  split_events: number;
  redemption_events: number;
  merge_usdc: number;
  split_usdc: number;
  clob_usdc: number;
  redemption_usdc: number;
}

async function buildCtfActiveCohort(): Promise<void> {
  console.log('='.repeat(80));
  console.log('CTF-ACTIVE VALIDATION COHORT BUILDER');
  console.log('='.repeat(80));
  console.log('');
  console.log('Finding wallets with PositionsMerge/Split activity for CashFull vs DomeCash testing');
  console.log('');

  // Query for wallets with CTF activity
  const query = `
    SELECT
      wallet_address as wallet,
      countIf(source_type = 'CLOB') as clob_events,
      countIf(source_type = 'PositionsMerge') as merge_events,
      countIf(source_type = 'PositionsSplit') as split_events,
      countIf(source_type = 'PayoutRedemption') as redemption_events,
      round(sumIf(usdc_delta, source_type = 'PositionsMerge'), 2) as merge_usdc,
      round(sumIf(usdc_delta, source_type = 'PositionsSplit'), 2) as split_usdc,
      round(sumIf(usdc_delta, source_type = 'CLOB'), 2) as clob_usdc,
      round(sumIf(usdc_delta, source_type = 'PayoutRedemption'), 2) as redemption_usdc
    FROM pm_unified_ledger_v8_tbl
    GROUP BY wallet_address
    HAVING
      -- Must have CTF activity
      (merge_events > 0 OR split_events > 0)
      -- Must have meaningful CLOB activity
      AND clob_events >= 50
      -- Must have some merge/split USDC movement (not just 0 amounts)
      AND (abs(merge_usdc) > 100 OR abs(split_usdc) > 100)
    ORDER BY (merge_events + split_events) DESC
    LIMIT 100
  `;

  console.log('Querying V8 ledger for CTF-active wallets...');
  const result = await ch.query({ query, format: 'JSONEachRow' });
  const wallets: WalletStats[] = await result.json();

  console.log(`Found ${wallets.length} CTF-active wallets\n`);

  // Display summary
  console.log('Sample CTF-Active Wallets:');
  console.log('-'.repeat(120));
  console.log(
    'Wallet           | CLOB Events | Merge Evt | Split Evt | Merge USDC     | Split USDC     | CLOB USDC'
  );
  console.log('-'.repeat(120));

  for (const w of wallets.slice(0, 20)) {
    console.log(
      `${w.wallet.slice(0, 16)} | ` +
        `${String(w.clob_events).padStart(11)} | ` +
        `${String(w.merge_events).padStart(9)} | ` +
        `${String(w.split_events).padStart(9)} | ` +
        `$${w.merge_usdc.toLocaleString().padStart(13)} | ` +
        `$${w.split_usdc.toLocaleString().padStart(13)} | ` +
        `$${w.clob_usdc.toLocaleString().padStart(12)}`
    );
  }

  // Summary stats
  const totalMergeUsdc = wallets.reduce((sum, w) => sum + Math.abs(w.merge_usdc), 0);
  const totalSplitUsdc = wallets.reduce((sum, w) => sum + Math.abs(w.split_usdc), 0);
  const avgMergeEvents = wallets.reduce((sum, w) => sum + w.merge_events, 0) / wallets.length;
  const avgSplitEvents = wallets.reduce((sum, w) => sum + w.split_events, 0) / wallets.length;

  console.log('-'.repeat(120));
  console.log(`\nCohort Summary:`);
  console.log(`  Total wallets: ${wallets.length}`);
  console.log(`  Avg merge events: ${avgMergeEvents.toFixed(1)}`);
  console.log(`  Avg split events: ${avgSplitEvents.toFixed(1)}`);
  console.log(`  Total |Merge USDC|: $${totalMergeUsdc.toLocaleString()}`);
  console.log(`  Total |Split USDC|: $${totalSplitUsdc.toLocaleString()}`);

  // Save cohort to file
  const outputPath = path.join(process.cwd(), 'tmp', 'ctf_active_clob_wallets_2025_12_09.json');
  const walletAddresses = wallets.map((w) => w.wallet);

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        name: 'CTF-Active Validation Cohort',
        created: new Date().toISOString(),
        description:
          'Wallets with PositionsMerge/Split activity for CashFull vs DomeCash differentiation testing',
        criteria: {
          merge_or_split_events: '> 0',
          clob_events: '>= 50',
          merge_or_split_usdc: '> $100',
        },
        count: wallets.length,
        wallets: walletAddresses,
        wallet_stats: wallets,
      },
      null,
      2
    )
  );

  console.log(`\nCohort saved to: ${outputPath}`);

  // Also save just wallet addresses for benchmark input
  const simpleOutputPath = path.join(
    process.cwd(),
    'tmp',
    'ctf_active_wallets_simple_2025_12_09.json'
  );
  fs.writeFileSync(simpleOutputPath, JSON.stringify(walletAddresses, null, 2));
  console.log(`Simple wallet list saved to: ${simpleOutputPath}`);

  await ch.close();
}

buildCtfActiveCohort().catch(console.error);
