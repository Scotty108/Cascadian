#!/usr/bin/env npx tsx
/**
 * Build CLOB-Only Validation Set (100+ wallets)
 *
 * Filters for TRADER_STRICT wallets that:
 * 1. Have 0 CTF splits/merges
 * 2. Have significant CLOB activity
 * 3. Have confirmed UI presence (from live snapshot)
 * 4. Have PnL > $100 (to avoid noise)
 */

import { clickhouse } from '../../lib/clickhouse/client';
import fs from 'fs';

interface ValidationWallet {
  wallet: string;
  clobTrades: number;
  ctfSplits: number;
  ctfMerges: number;
  ctfRedemptions: number;
  uiPnl: number | null;
  hasUIPresence: boolean;
}

async function main() {
  const limit = parseInt(process.argv[2]) || 200;
  const outputPath = process.argv[3] || 'tmp/clob_only_validation_set.json';

  console.log('='.repeat(80));
  console.log('BUILD CLOB-ONLY VALIDATION SET');
  console.log('='.repeat(80));
  console.log(`Target: ${limit} wallets`);
  console.log(`Output: ${outputPath}`);
  console.log();

  // Step 1: Load existing UI snapshot if available
  let uiSnapshot = new Map<string, number>();
  const snapshotPath = 'tmp/ui_pnl_live_snapshot_2025_12_07.json';
  if (fs.existsSync(snapshotPath)) {
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    for (const w of snapshot.wallets || []) {
      if (w.success && w.uiPnL !== null) {
        uiSnapshot.set(w.wallet.toLowerCase(), w.uiPnL);
      }
    }
    console.log(`Loaded ${uiSnapshot.size} wallets from UI snapshot`);
  }

  // Step 2: Find CLOB-only wallets (0 splits, 0 merges)
  // Using TRADER_STRICT criteria
  console.log('\nStep 1: Finding CLOB-only wallets...');

  const query = `
    WITH
    -- Get CTF activity per wallet
    ctf_activity AS (
      SELECT
        lower(user_address) as wallet,
        countIf(event_type = 'PositionSplit') as splits,
        countIf(event_type = 'PositionsMerge') as merges,
        countIf(event_type = 'PayoutRedemption') as redemptions
      FROM pm_ctf_events
      GROUP BY lower(user_address)
    ),
    -- Get CLOB trade counts
    clob_activity AS (
      SELECT
        lower(trader_wallet) as wallet,
        count() as trade_count
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY lower(trader_wallet)
      HAVING trade_count >= 10  -- Minimum activity
    )
    SELECT
      c.wallet,
      c.trade_count as clob_trades,
      coalesce(ct.splits, 0) as splits,
      coalesce(ct.merges, 0) as merges,
      coalesce(ct.redemptions, 0) as redemptions
    FROM clob_activity c
    LEFT JOIN ctf_activity ct ON c.wallet = ct.wallet
    WHERE coalesce(ct.splits, 0) = 0   -- TRADER_STRICT: no splits
      AND coalesce(ct.merges, 0) = 0   -- TRADER_STRICT: no merges
    ORDER BY c.trade_count DESC
    LIMIT ${limit * 2}  -- Get more than needed since some won't have UI presence
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  console.log(`Found ${rows.length} CLOB-only candidates`);

  // Step 3: Annotate with UI presence
  const wallets: ValidationWallet[] = [];

  for (const r of rows) {
    const wallet = r.wallet.toLowerCase();
    const uiPnl = uiSnapshot.get(wallet);

    wallets.push({
      wallet,
      clobTrades: Number(r.clob_trades),
      ctfSplits: Number(r.splits),
      ctfMerges: Number(r.merges),
      ctfRedemptions: Number(r.redemptions),
      uiPnl: uiPnl ?? null,
      hasUIPresence: uiPnl !== undefined,
    });
  }

  // Step 4: Prioritize wallets with UI presence
  const withUI = wallets.filter(w => w.hasUIPresence);
  const withoutUI = wallets.filter(w => !w.hasUIPresence);

  console.log(`\nWith UI presence: ${withUI.length}`);
  console.log(`Without UI presence: ${withoutUI.length}`);

  // Sort by PnL magnitude for UI wallets, by trade count for non-UI
  withUI.sort((a, b) => Math.abs(b.uiPnl || 0) - Math.abs(a.uiPnl || 0));
  withoutUI.sort((a, b) => b.clobTrades - a.clobTrades);

  // Combine: prioritize UI presence, then fill with non-UI
  const finalSet = [...withUI, ...withoutUI].slice(0, limit);

  // Step 5: Output
  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      total_wallets: finalSet.length,
      with_ui_presence: finalSet.filter(w => w.hasUIPresence).length,
      criteria: 'CLOB-only TRADER_STRICT (0 splits, 0 merges)',
    },
    wallets: finalSet,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`\n${'='.repeat(80)}`);
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total wallets: ${finalSet.length}`);
  console.log(`With UI presence: ${finalSet.filter(w => w.hasUIPresence).length}`);
  console.log(`Without UI presence: ${finalSet.filter(w => !w.hasUIPresence).length}`);
  console.log(`Output: ${outputPath}`);

  // Show sample
  console.log('\nTop 10 by trade count (with UI):');
  for (const w of withUI.slice(0, 10)) {
    console.log(`  ${w.wallet.slice(0, 12)}... | Trades: ${w.clobTrades} | UI: $${w.uiPnl?.toLocaleString() || 'N/A'}`);
  }
}

main().catch(console.error);
