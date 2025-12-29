/**
 * ============================================================================
 * EXPORT CLOB-VALIDATED WALLETS
 * ============================================================================
 *
 * Produces a filtered CSV/JSON export of wallets that pass CLOB-only gating.
 *
 * Inputs:
 *   - Latest candidate pool file (data/candidate-wallets.json)
 *   - Gating thresholds (flags)
 *   - Optional UI parity pass list
 *
 * Outputs:
 *   - data/exports/clob_validated_wallets_<timestamp>.csv
 *   - data/exports/clob_validated_wallets_<timestamp>.json
 *
 * Columns:
 *   wallet, v21_net, gain, loss, markets, clob_rows,
 *   external_sell_pct, mapped_ratio, ui_net (if tested), ui_delta_pct
 *
 * Usage:
 *   npx tsx scripts/pnl/export-clob-validated-wallets.ts
 *   npx tsx scripts/pnl/export-clob-validated-wallets.ts --max-external 0.5
 *   npx tsx scripts/pnl/export-clob-validated-wallets.ts --min-mapped 99.9
 *   npx tsx scripts/pnl/export-clob-validated-wallets.ts --limit 100
 *
 * ============================================================================
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { calculateV21PnL, V21WalletResult } from '../../lib/pnl/v21SyntheticEngine';
import * as fs from 'fs';
import * as path from 'path';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface ExportRow {
  wallet: string;
  v21_net: number;
  gain: number;
  loss: number;
  realized_pnl: number;
  unrealized_pnl: number;
  markets: number;
  positions: number;
  clob_rows: number;
  external_sell_pct: number;
  mapped_ratio: number;
  is_eligible: boolean;
  ui_net: number | null;
  ui_delta_pct: number | null;
}

// -----------------------------------------------------------------------------
// Parse Args
// -----------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  let maxExternal = 0.5;
  let minMapped = 99.9;
  let limit = 100;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max-external' && args[i + 1]) {
      maxExternal = parseFloat(args[i + 1]);
    }
    if (args[i] === '--min-mapped' && args[i + 1]) {
      minMapped = parseFloat(args[i + 1]);
    }
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1]);
    }
  }

  return { maxExternal, minMapped, limit };
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  const config = parseArgs();

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║               EXPORT CLOB-VALIDATED WALLETS                                ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('Configuration:');
  console.log(`  - max_external_sell_pct: ${config.maxExternal}%`);
  console.log(`  - min_mapped_ratio:      ${config.minMapped}%`);
  console.log(`  - limit:                 ${config.limit}`);
  console.log('');

  // Load candidate wallets
  const candidatesPath = path.join(process.cwd(), 'data', 'candidate-wallets.json');
  const candidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8')) as any[];

  // Take smallest wallets for faster processing
  const toProcess = candidates.slice(-Math.min(config.limit * 2, candidates.length));

  console.log(`Processing ${toProcess.length} candidate wallets...\n`);

  const results: ExportRow[] = [];
  let eligibleCount = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const c = toProcess[i];
    try {
      const v21 = await calculateV21PnL(c.wallet_address);

      const row: ExportRow = {
        wallet: c.wallet_address,
        v21_net: Math.round(v21.net * 100) / 100,
        gain: Math.round(v21.gain * 100) / 100,
        loss: Math.round(v21.loss * 100) / 100,
        realized_pnl: Math.round(v21.realized_pnl * 100) / 100,
        unrealized_pnl: Math.round(v21.unrealized_pnl * 100) / 100,
        markets: v21.markets,
        positions: v21.positions,
        clob_rows: v21.clob_rows,
        external_sell_pct: Math.round(v21.external_sell_pct * 1000) / 1000,
        mapped_ratio: Math.round(v21.mapped_ratio * 100) / 100,
        is_eligible: v21.external_sell_pct <= config.maxExternal && v21.mapped_ratio >= config.minMapped,
        ui_net: null,
        ui_delta_pct: null,
      };

      results.push(row);

      if (row.is_eligible) {
        eligibleCount++;
        const netStr = row.v21_net >= 0
          ? `+$${row.v21_net.toLocaleString()}`
          : `-$${Math.abs(row.v21_net).toLocaleString()}`;
        console.log(
          `✅ [${i + 1}/${toProcess.length}] ${c.wallet_address.slice(0, 12)}... | ` +
          `ext: ${row.external_sell_pct.toFixed(3)}% | net: ${netStr.padStart(12)}`
        );
      } else {
        console.log(
          `❌ [${i + 1}/${toProcess.length}] ${c.wallet_address.slice(0, 12)}... | ` +
          `ext: ${row.external_sell_pct.toFixed(2)}% (FAIL: external too high)`
        );
      }

      // Stop if we have enough eligible
      if (eligibleCount >= config.limit) {
        console.log(`\nReached limit of ${config.limit} eligible wallets.`);
        break;
      }
    } catch (e: any) {
      console.log(`❌ [${i + 1}/${toProcess.length}] ${c.wallet_address.slice(0, 12)}... | ERROR: ${e.message.slice(0, 40)}`);
    }
  }

  // Filter to eligible only for export
  const eligible = results.filter(r => r.is_eligible);

  // Sort by net PnL descending
  eligible.sort((a, b) => b.v21_net - a.v21_net);

  // Summary
  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                              SUMMARY                                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log(`  Total processed:  ${results.length}`);
  console.log(`  Eligible:         ${eligible.length}`);
  console.log(`  Failed gating:    ${results.length - eligible.length}`);

  if (eligible.length > 0) {
    const totalNet = eligible.reduce((sum, r) => sum + r.v21_net, 0);
    const profitable = eligible.filter(r => r.v21_net > 0);
    const unprofitable = eligible.filter(r => r.v21_net < 0);

    console.log('');
    console.log(`  Profitable:       ${profitable.length} (${((profitable.length / eligible.length) * 100).toFixed(1)}%)`);
    console.log(`  Unprofitable:     ${unprofitable.length}`);
    console.log(`  Total Net PnL:    ${totalNet >= 0 ? '+' : ''}$${totalNet.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  }

  // Ensure exports directory exists
  const exportsDir = path.join(process.cwd(), 'data', 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  // Write JSON
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const jsonPath = path.join(exportsDir, `clob_validated_wallets_${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    config,
    summary: {
      total_processed: results.length,
      eligible: eligible.length,
      profitable: eligible.filter(r => r.v21_net > 0).length,
    },
    wallets: eligible,
  }, null, 2));

  // Write CSV
  const csvPath = path.join(exportsDir, `clob_validated_wallets_${timestamp}.csv`);
  const csvHeader = 'wallet,v21_net,gain,loss,realized_pnl,unrealized_pnl,markets,positions,clob_rows,external_sell_pct,mapped_ratio';
  const csvRows = eligible.map(r =>
    `${r.wallet},${r.v21_net},${r.gain},${r.loss},${r.realized_pnl},${r.unrealized_pnl},${r.markets},${r.positions},${r.clob_rows},${r.external_sell_pct},${r.mapped_ratio}`
  );
  fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'));

  console.log(`\n✅ JSON export: ${jsonPath}`);
  console.log(`✅ CSV export:  ${csvPath}`);

  // Show top 10
  if (eligible.length > 0) {
    console.log('\n🏆 Top 10 Super Forecasters (by Net PnL):');
    console.log('┌────┬──────────────────────────────────────────────┬────────────────┬───────────────┐');
    console.log('│ #  │ Wallet                                       │ Net PnL        │ Ext Sell Pct  │');
    console.log('├────┼──────────────────────────────────────────────┼────────────────┼───────────────┤');

    eligible.slice(0, 10).forEach((r, i) => {
      const netStr = r.v21_net >= 0
        ? `+$${r.v21_net.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
        : `-$${Math.abs(r.v21_net).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
      console.log(
        `│ ${String(i + 1).padStart(2)} │ ${r.wallet.padEnd(44)} │ ${netStr.padStart(14)} │ ${(r.external_sell_pct.toFixed(3) + '%').padStart(13)} │`
      );
    });

    console.log('└────┴──────────────────────────────────────────────┴────────────────┴───────────────┘');
  }
}

main().catch(console.error);
