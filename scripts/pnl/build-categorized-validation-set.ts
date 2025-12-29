#!/usr/bin/env npx tsx
/**
 * Build Categorized Validation Dataset
 *
 * Creates a dataset of wallets tagged by their trading behavior:
 * - CLOB-only: Pure orderbook traders
 * - CTF splits/merges: Wallets with conditional token operations
 * - Redemptions: Wallets that have redeemed winning positions
 * - AMM/FPMM: Wallets that traded via automated market makers
 * - Transfers: Wallets with token transfers (in or out)
 *
 * Each category gets ~20 wallets for validation.
 */

import fs from 'fs';
import { clickhouse } from '../../lib/clickhouse/client';

interface CategorizedWallet {
  wallet_address: string;
  category: string;
  tags: string[];
  // Activity counts
  clob_trades: number;
  ctf_splits: number;
  ctf_merges: number;
  redemptions: number;
  transfers_in: number;
  transfers_out: number;
  // From Dome if available
  dome_realized?: number;
}

async function findClobOnlyWallets(limit: number): Promise<CategorizedWallet[]> {
  console.log(`Finding ${limit} CLOB-only wallets...`);

  const query = `
    WITH clob_wallets AS (
      SELECT
        lower(trader_wallet) as wallet,
        count(DISTINCT event_id) as trade_count
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY lower(trader_wallet)
      HAVING trade_count >= 10
    ),
    ctf_wallets AS (
      SELECT DISTINCT lower(user_address) as wallet FROM pm_ctf_events
    ),
    transfer_wallets AS (
      SELECT DISTINCT lower(from_address) as wallet FROM pm_erc1155_transfers
      UNION ALL
      SELECT DISTINCT lower(to_address) as wallet FROM pm_erc1155_transfers
    )
    SELECT
      c.wallet as wallet_address,
      c.trade_count as clob_trades
    FROM clob_wallets c
    WHERE c.wallet NOT IN (SELECT wallet FROM ctf_wallets)
      AND c.wallet NOT IN (SELECT wallet FROM transfer_wallets)
    ORDER BY c.trade_count DESC
    LIMIT ${limit}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  return rows.map(r => ({
    wallet_address: r.wallet_address,
    category: 'clob_only',
    tags: ['clob_only', 'no_ctf', 'no_transfers'],
    clob_trades: Number(r.clob_trades),
    ctf_splits: 0,
    ctf_merges: 0,
    redemptions: 0,
    transfers_in: 0,
    transfers_out: 0,
  }));
}

async function findCtfSplitMergeWallets(limit: number): Promise<CategorizedWallet[]> {
  console.log(`Finding ${limit} CTF split/merge wallets...`);

  // Simplified query - just get wallets with CTF splits/merges
  const query = `
    SELECT
      lower(user_address) as wallet_address,
      countIf(event_type = 'PositionSplit') as splits,
      countIf(event_type = 'PositionsMerge') as merges,
      countIf(event_type = 'PayoutRedemption') as redemptions
    FROM pm_ctf_events
    GROUP BY lower(user_address)
    HAVING splits > 0 OR merges > 0
    ORDER BY splits + merges DESC
    LIMIT ${limit}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  return rows.map(r => ({
    wallet_address: r.wallet_address,
    category: 'ctf_split_merge',
    tags: ['has_ctf', 'splits_merges'],
    clob_trades: 0, // Will be enriched later if needed
    ctf_splits: Number(r.splits),
    ctf_merges: Number(r.merges),
    redemptions: Number(r.redemptions),
    transfers_in: 0,
    transfers_out: 0,
  }));
}

async function findRedemptionWallets(limit: number): Promise<CategorizedWallet[]> {
  console.log(`Finding ${limit} redemption wallets...`);

  // Simplified query - just get wallets with redemptions
  const query = `
    SELECT
      lower(user_address) as wallet_address,
      countIf(event_type = 'PayoutRedemption') as redemptions,
      countIf(event_type = 'PositionSplit') as splits,
      countIf(event_type = 'PositionsMerge') as merges
    FROM pm_ctf_events
    GROUP BY lower(user_address)
    HAVING redemptions >= 3
    ORDER BY redemptions DESC
    LIMIT ${limit}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  return rows.map(r => ({
    wallet_address: r.wallet_address,
    category: 'redemptions',
    tags: ['has_redemptions', 'has_ctf'],
    clob_trades: 0, // Will be enriched later if needed
    ctf_splits: Number(r.splits),
    ctf_merges: Number(r.merges),
    redemptions: Number(r.redemptions),
    transfers_in: 0,
    transfers_out: 0,
  }));
}

async function findTransferWallets(limit: number): Promise<CategorizedWallet[]> {
  console.log(`Finding ${limit} transfer wallets...`);

  // Simplified query - get wallets with transfers (excluding null address)
  const query = `
    SELECT
      wallet as wallet_address,
      sum(transfers_in) as transfers_in,
      sum(transfers_out) as transfers_out
    FROM (
      SELECT lower(to_address) as wallet, count(*) as transfers_in, 0 as transfers_out
      FROM pm_erc1155_transfers
      WHERE lower(from_address) != '0x0000000000000000000000000000000000000000'
      GROUP BY lower(to_address)
      UNION ALL
      SELECT lower(from_address) as wallet, 0 as transfers_in, count(*) as transfers_out
      FROM pm_erc1155_transfers
      WHERE lower(to_address) != '0x0000000000000000000000000000000000000000'
      GROUP BY lower(from_address)
    )
    GROUP BY wallet
    HAVING transfers_in + transfers_out >= 5
    ORDER BY transfers_in + transfers_out DESC
    LIMIT ${limit}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  return rows.map(r => ({
    wallet_address: r.wallet_address,
    category: 'transfers',
    tags: ['has_transfers'],
    clob_trades: 0, // Will be enriched later if needed
    ctf_splits: 0,
    ctf_merges: 0,
    redemptions: 0,
    transfers_in: Number(r.transfers_in),
    transfers_out: Number(r.transfers_out),
  }));
}

async function findMixedActivityWallets(limit: number): Promise<CategorizedWallet[]> {
  console.log(`Finding ${limit} mixed-activity wallets (CLOB + CTF)...`);

  // Simplified: get CTF wallets and join with CLOB in a separate step
  // First just get the high-activity CTF wallets
  const query = `
    SELECT
      lower(user_address) as wallet_address,
      countIf(event_type = 'PositionSplit') as splits,
      countIf(event_type = 'PositionsMerge') as merges,
      countIf(event_type = 'PayoutRedemption') as redemptions
    FROM pm_ctf_events
    GROUP BY lower(user_address)
    HAVING (splits + merges + redemptions) >= 10
    ORDER BY (splits + merges + redemptions) DESC
    LIMIT ${limit}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  return rows.map(r => ({
    wallet_address: r.wallet_address,
    category: 'mixed',
    tags: ['has_ctf', 'complex'],
    clob_trades: 0, // Will be enriched later if needed
    ctf_splits: Number(r.splits),
    ctf_merges: Number(r.merges),
    redemptions: Number(r.redemptions),
    transfers_in: 0, // Will be enriched later if needed
    transfers_out: 0,
  }));
}

async function enrichWithDome(wallets: CategorizedWallet[]): Promise<CategorizedWallet[]> {
  console.log('Enriching with Dome benchmark data...');

  const walletList = wallets.map(w => `'${w.wallet_address}'`).join(',');

  const query = `
    SELECT
      lower(wallet_address) as wallet,
      dome_realized_value as realized_pnl
    FROM pm_dome_realized_benchmarks_v1
    WHERE lower(wallet_address) IN (${walletList})
      AND dome_realized_value IS NOT NULL
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as any[];

    const domeMap = new Map<string, number>();
    for (const r of rows) {
      domeMap.set(r.wallet.toLowerCase(), Number(r.realized_pnl));
    }

    return wallets.map(w => ({
      ...w,
      dome_realized: domeMap.get(w.wallet_address.toLowerCase()),
    }));
  } catch (err) {
    console.log('Dome table not available, skipping enrichment');
    return wallets;
  }
}

async function main() {
  const output = process.argv[2] || 'tmp/categorized_validation_set.json';
  const perCategory = parseInt(process.argv[3] || '20', 10);

  console.log('='.repeat(80));
  console.log('BUILDING CATEGORIZED VALIDATION DATASET');
  console.log('='.repeat(80));
  console.log(`Target: ${perCategory} wallets per category`);
  console.log(`Output: ${output}\n`);

  // Gather wallets from each category
  const clobOnly = await findClobOnlyWallets(perCategory);
  const ctfSplitMerge = await findCtfSplitMergeWallets(perCategory);
  const redemptions = await findRedemptionWallets(perCategory);
  const transfers = await findTransferWallets(perCategory);
  const mixed = await findMixedActivityWallets(perCategory);

  // Combine and dedupe
  const allWallets = [...clobOnly, ...ctfSplitMerge, ...redemptions, ...transfers, ...mixed];
  const seen = new Set<string>();
  const deduped = allWallets.filter(w => {
    if (seen.has(w.wallet_address)) return false;
    seen.add(w.wallet_address);
    return true;
  });

  // Enrich with Dome data
  const enriched = await enrichWithDome(deduped);

  // Summary
  const categoryCounts = new Map<string, number>();
  for (const w of enriched) {
    categoryCounts.set(w.category, (categoryCounts.get(w.category) || 0) + 1);
  }

  console.log('\n--- CATEGORY BREAKDOWN ---');
  for (const [cat, count] of categoryCounts) {
    console.log(`${cat}: ${count} wallets`);
  }
  console.log(`Total: ${enriched.length} wallets`);

  // Count Dome coverage
  const withDome = enriched.filter(w => w.dome_realized !== undefined).length;
  console.log(`\nDome benchmark coverage: ${withDome}/${enriched.length}`);

  // Save
  const outputData = {
    metadata: {
      generated_at: new Date().toISOString(),
      per_category_target: perCategory,
      total_wallets: enriched.length,
      categories: Object.fromEntries(categoryCounts),
      dome_coverage: withDome,
    },
    wallets: enriched,
  };

  fs.writeFileSync(output, JSON.stringify(outputData, null, 2));
  console.log(`\nSaved to: ${output}`);

  process.exit(0);
}

main().catch(console.error);
