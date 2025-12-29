/**
 * Debug V18 calculation for a specific wallet
 */

import { createV18Engine } from '../../lib/pnl/uiActivityEngineV18';

const WALLET = process.argv[2] || '0x50aa70b914e3bef42cbae3590b79ba646a52307c'; // fasdfdf

async function main() {
  console.log(`Debugging V18 for: ${WALLET}\n`);

  const engine = createV18Engine();
  const result = await engine.compute(WALLET);

  console.log('=== V18 RESULT ===');
  console.log(`Realized PnL:   $${result.realized_pnl.toFixed(2)}`);
  console.log(`Unrealized PnL: $${result.unrealized_pnl.toFixed(2)}`);
  console.log(`Total PnL:      $${result.total_pnl.toFixed(2)}`);
  console.log(`Positions:      ${result.positions_count}`);
  console.log(`Resolutions:    ${result.resolutions}`);

  console.log('\n=== POSITION BREAKDOWN ===');
  console.log('Condition ID               | Outcome | Resolved | Res Price | Cash Flow | Final Shares | Realized PnL | Unrealized');
  console.log('-'.repeat(120));

  // Sort by realized PnL to see biggest contributors
  const sorted = [...result.positions].sort((a, b) => Math.abs(b.realized_pnl) - Math.abs(a.realized_pnl));

  for (const pos of sorted.slice(0, 20)) {
    const condId = pos.condition_id.substring(0, 24) + '...';
    const resolved = pos.is_resolved ? 'Yes' : 'No';
    const resPrice = pos.resolution_price !== null ? pos.resolution_price.toFixed(2) : 'N/A';
    console.log(
      `${condId} | ${String(pos.outcome_index).padEnd(7)} | ${resolved.padEnd(8)} | ${resPrice.padStart(9)} | ${pos.trade_cash_flow.toFixed(2).padStart(9)} | ${pos.final_shares.toFixed(2).padStart(12)} | ${pos.realized_pnl.toFixed(2).padStart(12)} | ${pos.unrealized_pnl.toFixed(2).padStart(10)}`
    );
  }

  // Show totals
  const totalResolved = result.positions.filter(p => p.is_resolved);
  const totalUnresolved = result.positions.filter(p => !p.is_resolved);

  console.log('\n=== SUMMARY ===');
  console.log(`Resolved positions:   ${totalResolved.length}`);
  console.log(`Unresolved positions: ${totalUnresolved.length}`);

  const sumResolvedPnL = totalResolved.reduce((s, p) => s + p.realized_pnl, 0);
  const sumUnresolvedPnL = totalUnresolved.reduce((s, p) => s + p.unrealized_pnl, 0);
  console.log(`Sum resolved PnL:     $${sumResolvedPnL.toFixed(2)}`);
  console.log(`Sum unrealized PnL:   $${sumUnresolvedPnL.toFixed(2)}`);
}

main().catch(console.error);
