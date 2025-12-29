/**
 * Generate Super Forecasters Realized PnL Export
 *
 * Uses V19 engine (median 0.2% error) on exportable wallets.
 * Outputs /tmp/super_forecasters_realized.csv with defensible PnL data.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import * as fs from 'fs';
import { calculateV19PnL } from '../../lib/pnl/uiActivityEngineV19';

interface ExportRow {
  wallet: string;
  ui_pnl: number;
  v19_realized_pnl: number;
  v19_unrealized_pnl: number;
  v19_total_pnl: number;
  delta_pct: number;
  delta_abs: number;
  resolved_positions: number;
  open_positions: number;
  quality_grade: 'A' | 'B' | 'C' | 'F';
}

function gradeQuality(deltaPct: number): 'A' | 'B' | 'C' | 'F' {
  const abs = Math.abs(deltaPct);
  if (abs <= 1) return 'A';  // <1% error
  if (abs <= 5) return 'B';  // <5% error
  if (abs <= 20) return 'C'; // <20% error
  return 'F';                // >20% error
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   SUPER FORECASTERS REALIZED PnL EXPORT (V19)                              ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  // Read exportable wallets
  const csvPath = '/tmp/wallet_quality_exportable_realized.csv';
  if (!fs.existsSync(csvPath)) {
    console.error('ERROR: Run audit-wallet-input-quality.ts first');
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n').filter(l => l.trim());
  const header = lines[0].split(',');
  const walletIdx = header.indexOf('wallet');
  const uiPnlIdx = header.indexOf('ui_pnl');
  const resolvedIdx = header.indexOf('count_resolved_positions');
  const openIdx = header.indexOf('count_open_positions');

  const wallets: Array<{ wallet: string; ui_pnl: number; resolved: number; open: number }> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    wallets.push({
      wallet: cols[walletIdx],
      ui_pnl: parseFloat(cols[uiPnlIdx]),
      resolved: parseInt(cols[resolvedIdx]) || 0,
      open: parseInt(cols[openIdx]) || 0,
    });
  }

  console.log(`Processing ${wallets.length} exportable wallets...\n`);

  const results: ExportRow[] = [];
  const grades: Record<string, number> = { A: 0, B: 0, C: 0, F: 0 };

  for (let i = 0; i < wallets.length; i++) {
    const { wallet, ui_pnl, resolved, open } = wallets[i];
    process.stdout.write(`\r[${i + 1}/${wallets.length}] ${wallet.slice(0, 12)}...`);

    try {
      const v19 = await calculateV19PnL(wallet);
      const delta_pct = ui_pnl !== 0 ? ((v19.total_pnl - ui_pnl) / Math.abs(ui_pnl)) * 100 : 0;
      const delta_abs = v19.total_pnl - ui_pnl;
      const grade = gradeQuality(delta_pct);
      grades[grade]++;

      results.push({
        wallet,
        ui_pnl,
        v19_realized_pnl: v19.realized_pnl,
        v19_unrealized_pnl: v19.unrealized_pnl,
        v19_total_pnl: v19.total_pnl,
        delta_pct,
        delta_abs,
        resolved_positions: resolved,
        open_positions: open,
        quality_grade: grade,
      });
    } catch (e: any) {
      console.log(`\n   Error for ${wallet}: ${e.message.slice(0, 50)}`);
      results.push({
        wallet,
        ui_pnl,
        v19_realized_pnl: 0,
        v19_unrealized_pnl: 0,
        v19_total_pnl: 0,
        delta_pct: -100,
        delta_abs: -ui_pnl,
        resolved_positions: resolved,
        open_positions: open,
        quality_grade: 'F',
      });
      grades['F']++;
    }
  }

  console.log('\n\n' + '═'.repeat(100));
  console.log('EXPORT SUMMARY');
  console.log('═'.repeat(100));

  console.log(`\nTotal wallets: ${results.length}`);
  console.log(`Quality grades:`);
  console.log(`  A (<1% error):   ${grades.A}`);
  console.log(`  B (<5% error):   ${grades.B}`);
  console.log(`  C (<20% error):  ${grades.C}`);
  console.log(`  F (>20% error):  ${grades.F}`);

  // Sort by UI PnL descending
  results.sort((a, b) => b.ui_pnl - a.ui_pnl);

  // Calculate totals
  const totalUiPnl = results.reduce((s, r) => s + r.ui_pnl, 0);
  const totalV19Pnl = results.reduce((s, r) => s + r.v19_total_pnl, 0);

  console.log(`\nTotal UI PnL:  $${totalUiPnl.toLocaleString()}`);
  console.log(`Total V19 PnL: $${totalV19Pnl.toLocaleString()}`);
  console.log(`Total Delta:   $${(totalV19Pnl - totalUiPnl).toLocaleString()} (${(((totalV19Pnl - totalUiPnl) / Math.abs(totalUiPnl)) * 100).toFixed(1)}%)`);

  // Write CSV
  const csvHeader = 'wallet,ui_pnl,v19_realized_pnl,v19_unrealized_pnl,v19_total_pnl,delta_pct,delta_abs,resolved_positions,open_positions,quality_grade';
  const csvRows = results.map(r => [
    r.wallet,
    r.ui_pnl.toFixed(2),
    r.v19_realized_pnl.toFixed(2),
    r.v19_unrealized_pnl.toFixed(2),
    r.v19_total_pnl.toFixed(2),
    r.delta_pct.toFixed(2),
    r.delta_abs.toFixed(2),
    r.resolved_positions,
    r.open_positions,
    r.quality_grade,
  ].join(','));

  fs.writeFileSync('/tmp/super_forecasters_realized.csv', [csvHeader, ...csvRows].join('\n'));
  console.log(`\nWrote /tmp/super_forecasters_realized.csv (${results.length} rows)`);

  // Show top performers
  console.log('\n' + '─'.repeat(100));
  console.log('TOP SUPER FORECASTERS (by UI PnL):');
  console.log('─'.repeat(100));
  console.log('Wallet                                      | UI PnL        | V19 PnL       | Delta  | Grade');
  console.log('─'.repeat(100));

  for (const r of results.slice(0, 20)) {
    const ui = `$${r.ui_pnl.toLocaleString().padStart(12)}`;
    const v19 = `$${r.v19_total_pnl.toLocaleString().padStart(12)}`;
    const delta = `${r.delta_pct.toFixed(1)}%`.padStart(6);
    console.log(`${r.wallet} | ${ui} | ${v19} | ${delta} | ${r.quality_grade}`);
  }

  console.log('\n' + '═'.repeat(100));
  console.log('EXPORT COMPLETE');
  console.log('═'.repeat(100));
  console.log('\nFile: /tmp/super_forecasters_realized.csv');
  console.log('Engine: V19 (median 0.2% error, validated on 14 wallets)');
  console.log('Scope: Realized PnL only (all positions resolved)');
}

main().catch(console.error);
