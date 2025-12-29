/**
 * Debug script: Reconcile Dome-like realized PnL from first principles
 *
 * Prints the three-component breakdown:
 * 1. cash_realized = sum(usdc_delta) across ALL source_types
 * 2. resolved_unredeemed_winning_value
 * 3. dome_like_realized = 1 + 2
 * 4. Compare vs Dome API number
 *
 * Uses the canonical realizedDomeLikeV1 function for calculation.
 */
import fs from 'fs';
import { calculateRealizedDomeLike } from '../../lib/pnl/realizedDomeLikeV1';

const DEFAULT_WALLET = '0x56687bf447db6ffa42ffe2204a05edaa20f55839'; // Known good wallet

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  const wallet = (process.argv[2] || DEFAULT_WALLET).toLowerCase();

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`DOME-LIKE REALIZED PNL RECONCILIATION`);
  console.log(`Wallet: ${wallet}`);
  console.log(`${'═'.repeat(70)}\n`);

  // Calculate using the canonical function
  const result = await calculateRealizedDomeLike(wallet);

  // Component 1: Cash Realized
  console.log(`1. CASH REALIZED (actual money flow)`);
  console.log(`   CLOB trading:        $${fmt(result.cash_breakdown.clob)}`);
  console.log(`   PayoutRedemption:    $${fmt(result.cash_breakdown.redemption)}`);
  console.log(`   Other:               $${fmt(result.cash_breakdown.other)}`);
  console.log(`   ${'─'.repeat(40)}`);
  console.log(`   Total cash_realized: $${fmt(result.cash_realized)}`);
  console.log('');

  // Component 2: Resolved Unredeemed Winning Value
  console.log(`2. RESOLVED UNREDEEMED WINNING VALUE`);
  console.log(`   Winning positions held:  ${result.winning_positions_held}`);
  console.log(`   Losing positions held:   ${result.losing_positions_held} (worth $0)`);
  console.log(`   Conditions traded:       ${result.total_conditions_traded}`);
  console.log(`   Conditions resolved:     ${result.total_conditions_resolved}`);
  console.log(`   ${'─'.repeat(40)}`);
  console.log(`   Total unredeemed value:  $${fmt(result.resolved_unredeemed_winning_value)}`);
  console.log('');

  // Component 3: Dome-like Realized
  console.log(`3. DOME-LIKE REALIZED PNL`);
  console.log(`   cash_realized:           $${fmt(result.cash_realized)}`);
  console.log(`   + unredeemed winners:    $${fmt(result.resolved_unredeemed_winning_value)}`);
  console.log(`   ${'═'.repeat(40)}`);
  console.log(`   dome_like_realized:      $${fmt(result.realized_dome_like)}`);
  console.log('');

  // Component 4: Compare to Dome
  console.log(`4. COMPARISON VS DOME API`);
  console.log(`   Our dome_like_realized:  $${fmt(result.realized_dome_like)}`);

  // Try to load Dome benchmark if available
  let domeRealized: number | null = null;
  const benchmarkFiles = [
    'tmp/dome_realized_omega_top50_2025_12_07.json',
    'tmp/dome_realized_small_20_2025_12_07.json',
  ];

  for (const file of benchmarkFiles) {
    try {
      if (fs.existsSync(file)) {
        const domeData = JSON.parse(fs.readFileSync(file, 'utf8'));
        const domeWallet = domeData.wallets?.find((w: any) => w.wallet.toLowerCase() === wallet);
        if (domeWallet) {
          domeRealized = domeWallet.realizedPnl;
          console.log(`   Dome benchmark:          $${fmt(domeRealized!)}`);
          console.log(`   Source:                  ${file}`);
          break;
        }
      }
    } catch {
      // Continue to next file
    }
  }

  if (domeRealized !== null) {
    const errPct = Math.abs(result.realized_dome_like - domeRealized) / Math.max(1, Math.abs(domeRealized)) * 100;
    const diff = result.realized_dome_like - domeRealized;
    console.log(`   ${'─'.repeat(40)}`);
    console.log(`   Difference:              $${fmt(diff)}`);
    console.log(`   Error:                   ${errPct.toFixed(2)}%`);
    console.log(`   Status:                  ${errPct < 6 ? '✅ PASS (<6% error)' : '❌ FAIL (>=6% error)'}`);
  } else {
    console.log(`   (Dome benchmark not found for this wallet)`);
  }

  console.log('');
  console.log(`${'═'.repeat(70)}`);

  return result;
}

main().catch(console.error);
