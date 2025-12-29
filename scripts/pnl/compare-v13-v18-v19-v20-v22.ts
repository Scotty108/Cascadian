/**
 * Compare PnL engines V13, V17, V18, V19, V20, V22 on failing UI spot check wallets
 *
 * Test wallets (from UI spot check failures):
 * - 0x35f0a66e8a0ddcb49cb93213b21642bdd854b776: V18 +3813.99 vs UI +3291.63
 * - 0x34393448709dd71742f4a8f8b973955cf59b4f64: V18 -8259.78 vs UI 0.00
 * - 0x227c55d09ff49d420fc741c5e301904af62fa303: V18 +184.09 vs UI -278.07 (wrong sign)
 * - 0x222adc4302f58fe679f5212cf11344d29c0d103c: V18 0.00 vs UI +520.00
 * - 0x0e5f632cdfb0f5a22d22331fd81246f452dccf38: V18 -1.00 vs UI -399.79
 */

import { createV13Engine } from '../../lib/pnl/uiActivityEngineV13';
import { createV17Engine } from '../../lib/pnl/uiActivityEngineV17';
import { createV18Engine } from '../../lib/pnl/uiActivityEngineV18';
import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';
import { calculateV22PnL } from '../../lib/pnl/uiActivityEngineV22';

interface WalletTest {
  address: string;
  ui_pnl: number;
  v18_pnl: number;
  description: string;
}

const testWallets: WalletTest[] = [
  {
    address: '0x35f0a66e8a0ddcb49cb93213b21642bdd854b776',
    ui_pnl: 3291.63,
    v18_pnl: 3813.99,
    description: 'V18 over by $522 (+15.9%)',
  },
  {
    address: '0x34393448709dd71742f4a8f8b973955cf59b4f64',
    ui_pnl: 0.0,
    v18_pnl: -8259.78,
    description: 'V18 shows massive loss, UI shows zero',
  },
  {
    address: '0x227c55d09ff49d420fc741c5e301904af62fa303',
    ui_pnl: -278.07,
    v18_pnl: 184.09,
    description: 'Wrong sign: V18 +$184, UI -$278',
  },
  {
    address: '0x222adc4302f58fe679f5212cf11344d29c0d103c',
    ui_pnl: 520.0,
    v18_pnl: 0.0,
    description: 'V18 missing $520 profit',
  },
  {
    address: '0x0e5f632cdfb0f5a22d22331fd81246f452dccf38',
    ui_pnl: -399.79,
    v18_pnl: -1.0,
    description: 'V18 undercounting loss by $399',
  },
];

async function main() {
  console.log('='.repeat(100));
  console.log('PNL ENGINE COMPARISON: V13, V17, V18, V19, V20, V22');
  console.log('='.repeat(100));
  console.log('');

  const v13Engine = createV13Engine();
  const v17Engine = createV17Engine();
  const v18Engine = createV18Engine();

  const results: any[] = [];

  for (const test of testWallets) {
    console.log(`\nWallet: ${test.address}`);
    console.log(`UI Reference: $${test.ui_pnl.toFixed(2)}`);
    console.log(`Issue: ${test.description}`);
    console.log('-'.repeat(100));

    try {
      // V13 - CLOB only with weighted average cost basis
      const v13 = await v13Engine.compute(test.address);

      // V17 - Canonical Cascadian (all roles, dedup table, paired normalization)
      const v17 = await v17Engine.compute(test.address);

      // V18 - UI Parity mode (maker only, rounded to cents)
      const v18 = await v18Engine.compute(test.address);

      // V20 - Unified ledger v7 (CLOB only, canonical)
      const v20 = await calculateV20PnL(test.address);

      // V22 - Experimental dual formula
      const v22 = await calculateV22PnL(test.address);

      const result = {
        wallet: test.address.substring(0, 10) + '...',
        ui_pnl: test.ui_pnl,
        v13_total: v13.total_pnl,
        v13_error: ((v13.total_pnl - test.ui_pnl) / Math.abs(test.ui_pnl)) * 100,
        v17_total: v17.total_pnl,
        v17_error: ((v17.total_pnl - test.ui_pnl) / Math.abs(test.ui_pnl)) * 100,
        v18_total: v18.total_pnl,
        v18_error: ((v18.total_pnl - test.ui_pnl) / Math.abs(test.ui_pnl)) * 100,
        v20_total: v20.total_pnl,
        v20_error: ((v20.total_pnl - test.ui_pnl) / Math.abs(test.ui_pnl)) * 100,
        v22_total: v22.total_pnl,
        v22_error: ((v22.total_pnl - test.ui_pnl) / Math.abs(test.ui_pnl)) * 100,
      };

      results.push(result);

      console.log(`V13 (CLOB weighted avg): $${v13.total_pnl.toFixed(2)} (${result.v13_error.toFixed(1)}% error)`);
      console.log(`  - Realized: $${v13.realized_pnl.toFixed(2)}, Unrealized: $${v13.unrealized_pnl.toFixed(2)}`);
      console.log(
        `  - Trades: ${v13.clob_trades} CLOB, ${v13.negrisk_acquisitions} NegRisk, ${v13.ctf_splits} splits, ${v13.ctf_merges} merges`
      );

      console.log(`V17 (Canonical): $${v17.total_pnl.toFixed(2)} (${result.v17_error.toFixed(1)}% error)`);
      console.log(`  - Realized: $${v17.realized_pnl.toFixed(2)}, Unrealized: $${v17.unrealized_pnl.toFixed(2)}`);
      console.log(`  - Positions: ${v17.positions_count}, Markets: ${v17.markets_traded}, Resolutions: ${v17.resolutions}`);

      console.log(`V18 (UI Parity - Maker): $${v18.total_pnl.toFixed(2)} (${result.v18_error.toFixed(1)}% error)`);
      console.log(`  - Realized: $${v18.realized_pnl.toFixed(2)}, Unrealized: $${v18.unrealized_pnl.toFixed(2)}`);
      console.log(`  - Positions: ${v18.positions_count}, Markets: ${v18.markets_traded}, Resolutions: ${v18.resolutions}`);

      console.log(`V20 (Unified Ledger v7): $${v20.total_pnl.toFixed(2)} (${result.v20_error.toFixed(1)}% error)`);
      console.log(`  - Realized: $${v20.realized_pnl.toFixed(2)}, Unrealized: $${v20.unrealized_pnl.toFixed(2)}`);
      console.log(`  - Positions: ${v20.positions}, Resolved: ${v20.resolved}`);

      console.log(`V22 (Dual Formula): $${v22.total_pnl.toFixed(2)} (${result.v22_error.toFixed(1)}% error)`);
      console.log(`  - Realized: $${v22.realized_pnl.toFixed(2)}, Unrealized: $${v22.unrealized_pnl.toFixed(2)}`);
      console.log(`  - Closed: $${v22.closed_pnl.toFixed(2)}, Open Resolved: $${v22.open_resolved_pnl.toFixed(2)}, Open Unresolved: $${v22.open_unresolved_pnl.toFixed(2)}`);
      console.log(`  - CLOB: $${v22.clob_usdc.toFixed(2)}, Redemption: $${v22.redemption_usdc.toFixed(2)}, Merge: $${v22.merge_usdc.toFixed(2)}`);

      // Find best match
      const errors = [
        { engine: 'V13', error: Math.abs(result.v13_error) },
        { engine: 'V17', error: Math.abs(result.v17_error) },
        { engine: 'V18', error: Math.abs(result.v18_error) },
        { engine: 'V20', error: Math.abs(result.v20_error) },
        { engine: 'V22', error: Math.abs(result.v22_error) },
      ];
      errors.sort((a, b) => a.error - b.error);

      console.log(`\n🏆 Best Match: ${errors[0].engine} (${errors[0].error.toFixed(1)}% error)`);
    } catch (err) {
      console.error(`Error processing wallet ${test.address}:`, err);
    }
  }

  // Summary table
  console.log('\n\n');
  console.log('='.repeat(100));
  console.log('SUMMARY TABLE');
  console.log('='.repeat(100));
  console.log('');
  console.log('Wallet          | UI PnL    | V13       | V17       | V18       | V20       | V22       | Best');
  console.log('-'.repeat(100));

  for (const r of results) {
    const errors = [
      { engine: 'V13', error: Math.abs(r.v13_error) },
      { engine: 'V17', error: Math.abs(r.v17_error) },
      { engine: 'V18', error: Math.abs(r.v18_error) },
      { engine: 'V20', error: Math.abs(r.v20_error) },
      { engine: 'V22', error: Math.abs(r.v22_error) },
    ];
    errors.sort((a, b) => a.error - b.error);

    console.log(
      `${r.wallet} | $${r.ui_pnl.toFixed(2).padStart(8)} | $${r.v13_total.toFixed(2).padStart(8)} | $${r.v17_total.toFixed(2).padStart(8)} | $${r.v18_total.toFixed(2).padStart(8)} | $${r.v20_total.toFixed(2).padStart(8)} | $${r.v22_total.toFixed(2).padStart(8)} | ${errors[0].engine}`
    );
  }

  console.log('');
  console.log('='.repeat(100));
}

main().catch(console.error);
