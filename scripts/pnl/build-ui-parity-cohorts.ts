#!/usr/bin/env npx tsx
/**
 * ============================================================================
 * BUILD UI PARITY COHORTS
 * ============================================================================
 *
 * Creates labeled wallet cohorts for unified validation per PNL_PARITY_NORTH_STAR.md
 *
 * Cohorts:
 *   1. CLOB-only, positions closed
 *   2. CLOB-only, active positions
 *   3. Mixed source (has CTF events)
 *   4. Transfer-heavy
 *
 * Usage:
 *   npx tsx scripts/pnl/build-ui-parity-cohorts.ts --limit=100 --output=tmp/ui_parity_cohorts.json
 */

import fs from 'fs';
import { getClickHouseClient } from '../../lib/clickhouse/client';

// Parse CLI args
const args = process.argv.slice(2);
let limit = 500;
let output = 'tmp/ui_parity_cohorts.json';
let minTrades = 10;
let minPnlMagnitude = 0; // 0 = no filter, set to 200 for leaderboard

for (const arg of args) {
  if (arg.startsWith('--limit=')) limit = parseInt(arg.split('=')[1]);
  if (arg.startsWith('--output=')) output = arg.split('=')[1];
  if (arg.startsWith('--min-trades=')) minTrades = parseInt(arg.split('=')[1]);
  if (arg.startsWith('--min-pnl=')) minPnlMagnitude = parseInt(arg.split('=')[1]);
}

type Cohort = 'clob_closed' | 'clob_active' | 'mixed_source' | 'transfer_heavy';

interface LabeledWallet {
  wallet: string;
  cohort: Cohort;
  trade_count: number;
  transfer_count: number;
  split_count: number;
  merge_count: number;
  has_active_positions: boolean;
  realized_pnl_est: number;
}

async function main() {
  console.log('═'.repeat(80));
  console.log('BUILD UI PARITY COHORTS');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Config:');
  console.log(`  limit: ${limit}`);
  console.log(`  output: ${output}`);
  console.log(`  min-trades: ${minTrades}`);
  console.log(`  min-pnl: ${minPnlMagnitude}`);
  console.log('');

  const client = getClickHouseClient();

  // Step 1: Get active wallets with trade counts
  console.log('Step 1: Finding active wallets...');
  const walletsQuery = `
    SELECT
      lower(trader_wallet) as wallet,
      count() as trade_count,
      sum(usdc_amount) / 1e6 as total_volume
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
    GROUP BY wallet
    HAVING trade_count >= ${minTrades}
    ORDER BY total_volume DESC
    LIMIT ${limit * 2}
  `;
  const walletsResult = await client.query({ query: walletsQuery, format: 'JSONEachRow' });
  const wallets = await walletsResult.json<Array<{ wallet: string; trade_count: string; total_volume: string }>>();
  console.log(`  Found ${wallets.length} wallets with >= ${minTrades} trades`);

  // Step 2: Get transfer counts (batch)
  console.log('Step 2: Checking ERC1155 transfers...');
  const walletList = wallets.map(w => w.wallet);
  const transferCounts = new Map<string, number>();

  const CHUNK_SIZE = 100;
  for (let i = 0; i < walletList.length; i += CHUNK_SIZE) {
    const chunk = walletList.slice(i, i + CHUNK_SIZE);
    const quoted = chunk.map(w => `'${w}'`).join(',');
    const transferQuery = `
      SELECT wallet, count() as cnt FROM (
        SELECT lower(from_address) as wallet FROM pm_erc1155_transfers WHERE lower(from_address) IN (${quoted})
        UNION ALL
        SELECT lower(to_address) as wallet FROM pm_erc1155_transfers WHERE lower(to_address) IN (${quoted})
      ) GROUP BY wallet
    `;
    const transferResult = await client.query({ query: transferQuery, format: 'JSONEachRow' });
    const transfers = await transferResult.json<Array<{ wallet: string; cnt: string }>>();
    for (const t of transfers) {
      transferCounts.set(t.wallet, parseInt(t.cnt));
    }
  }
  console.log(`  ${transferCounts.size} wallets have transfers`);

  // Step 3: Get CTF event counts (splits/merges)
  console.log('Step 3: Checking CTF events (splits/merges)...');
  const ctfCounts = new Map<string, { splits: number; merges: number }>();

  for (let i = 0; i < walletList.length; i += CHUNK_SIZE) {
    const chunk = walletList.slice(i, i + CHUNK_SIZE);
    const quoted = chunk.map(w => `'${w}'`).join(',');
    const ctfQuery = `
      SELECT
        lower(wallet_address) as wallet,
        countIf(event_type IN ('SPLIT', 'ConditionSplit')) as splits,
        countIf(event_type IN ('MERGE', 'ConditionMerge')) as merges
      FROM pm_ctf_events
      WHERE lower(wallet_address) IN (${quoted})
      GROUP BY wallet
    `;
    try {
      const ctfResult = await client.query({ query: ctfQuery, format: 'JSONEachRow' });
      const ctfRows = await ctfResult.json<Array<{ wallet: string; splits: string; merges: string }>>();
      for (const c of ctfRows) {
        ctfCounts.set(c.wallet, { splits: parseInt(c.splits), merges: parseInt(c.merges) });
      }
    } catch {
      // pm_ctf_events might not exist
    }
  }
  console.log(`  ${ctfCounts.size} wallets have CTF events`);

  // Step 4: Check for active positions (simplified - check if any unresolved markets)
  console.log('Step 4: Checking for active positions...');
  const activePositions = new Map<string, boolean>();

  // This is a simplified check - we look for wallets that have trades in unresolved markets
  // A more accurate check would sum shares per market and check resolution status
  for (let i = 0; i < walletList.length; i += CHUNK_SIZE) {
    const chunk = walletList.slice(i, i + CHUNK_SIZE);
    const quoted = chunk.map(w => `'${w}'`).join(',');

    // Check if wallet has any positions in unresolved markets
    const activeQuery = `
      SELECT lower(trader_wallet) as wallet, 1 as has_active
      FROM pm_trader_events_v2 t
      LEFT JOIN pm_market_resolution_prices_v2 r
        ON t.condition_id = r.condition_id
      WHERE lower(trader_wallet) IN (${quoted})
        AND t.is_deleted = 0
        AND r.condition_id IS NULL  -- No resolution = active
      GROUP BY wallet
    `;
    try {
      const activeResult = await client.query({ query: activeQuery, format: 'JSONEachRow' });
      const activeRows = await activeResult.json<Array<{ wallet: string }>>();
      for (const a of activeRows) {
        activePositions.set(a.wallet, true);
      }
    } catch {
      // Table might not exist
    }
  }
  console.log(`  ${activePositions.size} wallets have active positions`);

  // Step 5: Estimate realized PnL using CLOB cash flow
  console.log('Step 5: Estimating realized PnL...');
  const realizedPnl = new Map<string, number>();

  for (let i = 0; i < walletList.length; i += CHUNK_SIZE) {
    const chunk = walletList.slice(i, i + CHUNK_SIZE);
    const quoted = chunk.map(w => `'${w}'`).join(',');

    const pnlQuery = `
      SELECT
        lower(trader_wallet) as wallet,
        sum(CASE WHEN side = 'BUY' THEN -usdc_amount ELSE usdc_amount END) / 1e6 as pnl
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) IN (${quoted})
        AND is_deleted = 0
      GROUP BY wallet
    `;
    const pnlResult = await client.query({ query: pnlQuery, format: 'JSONEachRow' });
    const pnlRows = await pnlResult.json<Array<{ wallet: string; pnl: string }>>();
    for (const p of pnlRows) {
      realizedPnl.set(p.wallet, parseFloat(p.pnl));
    }
  }

  // Step 6: Classify wallets into cohorts
  console.log('Step 6: Classifying wallets into cohorts...');

  const labeled: LabeledWallet[] = [];

  for (const w of wallets) {
    const wallet = w.wallet;
    const trade_count = parseInt(w.trade_count);
    const transfer_count = transferCounts.get(wallet) || 0;
    const ctf = ctfCounts.get(wallet) || { splits: 0, merges: 0 };
    const has_active = activePositions.get(wallet) || false;
    const pnl = realizedPnl.get(wallet) || 0;

    // Apply PnL magnitude filter if specified
    if (minPnlMagnitude > 0 && Math.abs(pnl) < minPnlMagnitude) {
      continue;
    }

    // Classify per decision tree in North Star
    let cohort: Cohort;

    if (transfer_count > 0) {
      cohort = 'transfer_heavy';
    } else if (ctf.splits > 0 || ctf.merges > 0) {
      cohort = 'mixed_source';
    } else if (has_active) {
      cohort = 'clob_active';
    } else {
      cohort = 'clob_closed';
    }

    labeled.push({
      wallet,
      cohort,
      trade_count,
      transfer_count,
      split_count: ctf.splits,
      merge_count: ctf.merges,
      has_active_positions: has_active,
      realized_pnl_est: pnl,
    });

    if (labeled.length >= limit) break;
  }

  // Step 7: Summary
  console.log('');
  console.log('═'.repeat(80));
  console.log('COHORT SUMMARY');
  console.log('═'.repeat(80));

  const byCohort = new Map<Cohort, LabeledWallet[]>();
  for (const w of labeled) {
    if (!byCohort.has(w.cohort)) byCohort.set(w.cohort, []);
    byCohort.get(w.cohort)!.push(w);
  }

  const cohortOrder: Cohort[] = ['clob_closed', 'clob_active', 'mixed_source', 'transfer_heavy'];
  for (const cohort of cohortOrder) {
    const wallets = byCohort.get(cohort) || [];
    const v1Eligible = cohort === 'clob_closed' || cohort === 'clob_active';
    console.log(`\n${cohort.toUpperCase()} (${v1Eligible ? 'v1 ELIGIBLE' : 'excluded'}): ${wallets.length} wallets`);
    if (wallets.length > 0) {
      const winners = wallets.filter(w => w.realized_pnl_est > 0).length;
      const avgPnl = wallets.reduce((s, w) => s + w.realized_pnl_est, 0) / wallets.length;
      console.log(`  Winners: ${winners} (${(winners/wallets.length*100).toFixed(1)}%)`);
      console.log(`  Avg PnL: $${avgPnl.toFixed(2)}`);
    }
  }

  const v1Count = (byCohort.get('clob_closed')?.length || 0) + (byCohort.get('clob_active')?.length || 0);
  console.log(`\nTOTAL v1 ELIGIBLE: ${v1Count} wallets`);

  // Step 8: Save output
  const outputData = {
    generated_at: new Date().toISOString(),
    config: { limit, minTrades, minPnlMagnitude },
    summary: {
      total: labeled.length,
      by_cohort: Object.fromEntries(cohortOrder.map(c => [c, byCohort.get(c)?.length || 0])),
      v1_eligible: v1Count,
    },
    wallets: labeled,
  };

  fs.writeFileSync(output, JSON.stringify(outputData, null, 2));
  console.log(`\n✅ Saved to ${output}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
