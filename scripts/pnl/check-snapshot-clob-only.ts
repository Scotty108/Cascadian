#!/usr/bin/env npx tsx
/**
 * Check which UI snapshot wallets are CLOB-only
 */

import fs from 'fs';
import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  const snapshot = JSON.parse(fs.readFileSync('tmp/ui_pnl_live_snapshot_2025_12_07.json', 'utf-8'));
  const successWallets = snapshot.wallets.filter((w: any) => w.success && w.uiPnL !== null);

  console.log('UI Snapshot wallets with CTF activity check:');
  console.log('='.repeat(80));

  const clobOnlyWallets: any[] = [];

  for (const w of successWallets) {
    const wallet = w.wallet.toLowerCase();

    // Check CTF activity
    const ctfQuery = `
      SELECT
        countIf(event_type = 'PositionSplit') as splits,
        countIf(event_type = 'PositionsMerge') as merges,
        countIf(event_type = 'PayoutRedemption') as redemptions
      FROM pm_ctf_events
      WHERE lower(user_address) = '${wallet}'
    `;

    const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
    const ctfRows = (await ctfResult.json()) as any[];
    const ctf = ctfRows[0] || { splits: 0, merges: 0, redemptions: 0 };

    const isClobOnly = Number(ctf.splits) === 0 && Number(ctf.merges) === 0;

    if (isClobOnly) {
      clobOnlyWallets.push({
        wallet,
        uiPnl: w.uiPnL,
        redemptions: Number(ctf.redemptions),
      });
      console.log(`CLOB_ONLY: ${wallet.slice(0, 12)}... | UI: $${w.uiPnL?.toLocaleString()} | Redeem: ${ctf.redemptions}`);
    }
  }

  console.log(`\nFound ${clobOnlyWallets.length} CLOB-only wallets out of ${successWallets.length} total`);

  // Save the CLOB-only subset
  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      source: 'ui_pnl_live_snapshot_2025_12_07.json',
      total_in_snapshot: successWallets.length,
      clob_only_count: clobOnlyWallets.length,
    },
    wallets: clobOnlyWallets.map((w: any) => ({
      wallet: w.wallet,
      uiPnl: w.uiPnl,
      ctfRedemptions: w.redemptions,
      clobTrades: 0, // Will be filled if needed
      hasUIPresence: true,
    })),
  };

  fs.writeFileSync('tmp/clob_only_from_snapshot.json', JSON.stringify(output, null, 2));
  console.log('\nSaved to: tmp/clob_only_from_snapshot.json');
}

main().catch(console.error);
