/**
 * Compute Wallet Cash PnL
 *
 * Computes pure cash flow PnL directly from ClickHouse.
 * This is a simple sanity check - just sums USDC in/out by source type.
 *
 * Key insight: The wallet's true cash PnL is simply:
 *   cash_out - cash_in = net USDC change
 *
 * For CLOB trades:
 *   - BUY: negative USDC (spending)
 *   - SELL: positive USDC (receiving)
 *
 * For PayoutRedemption:
 *   - Always positive USDC (receiving payout)
 *
 * Splits and merges are ignored (no USDC movement for wallet).
 *
 * Usage:
 *   npx tsx scripts/pnl/compute-wallet-cash-pnl.ts <wallet_address>
 *   npx tsx scripts/pnl/compute-wallet-cash-pnl.ts --known
 *
 * Example:
 *   npx tsx scripts/pnl/compute-wallet-cash-pnl.ts 0x7fb7ad0d...
 */

import { clickhouse } from '../../lib/clickhouse/client';

// Known wallets from manual autopsy
const KNOWN_WALLETS = [
  { address: '0x7fb7ad0d08fd29ab8a0562fefd1e1d4ae6de4034', label: 'BAD - huge error' },
  { address: '0x82a1b239a08ab879eb34b7a03e9b59e6cf08ea0d', label: 'GOOD - V29 correct' },
  { address: '0x343d44668ab68c2e7c7ab02d2fc7b2cba26f8e49', label: 'MEDIUM error' },
  { address: '0xee00ba333f1e4f0851e4f18c1d26c70d91b4d90d', label: 'MAKER heavy' },
];

export interface CashPnlResult {
  wallet: string;
  clob_cash_in: number;        // USDC received from CLOB sells
  clob_cash_out: number;       // USDC spent on CLOB buys
  clob_net: number;            // Net CLOB cash flow
  redemption_cash: number;     // USDC received from redemptions
  total_cash_pnl: number;      // clob_net + redemption_cash
  event_count: number;
  clob_count: number;
  redemption_count: number;
}

export async function computeWalletCashPnl(wallet: string): Promise<CashPnlResult> {
  // Query for CLOB cash flows
  const clobQuery = `
    SELECT
      sum(if(usdc_delta > 0, usdc_delta, 0)) as cash_in,
      sum(if(usdc_delta < 0, abs(usdc_delta), 0)) as cash_out,
      sum(usdc_delta) as net_cash,
      count() as event_count
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower('${wallet}')
      AND source_type = 'CLOB'
      AND condition_id IS NOT NULL
      AND condition_id != ''
  `;

  // Query for redemption cash flows
  const redemptionQuery = `
    SELECT
      sum(usdc_delta) as redemption_cash,
      count() as event_count
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower('${wallet}')
      AND source_type = 'PayoutRedemption'
      AND condition_id IS NOT NULL
      AND condition_id != ''
  `;

  const [clobResult, redemptionResult] = await Promise.all([
    clickhouse.query({ query: clobQuery, format: 'JSONEachRow' }),
    clickhouse.query({ query: redemptionQuery, format: 'JSONEachRow' }),
  ]);

  const clobRows = (await clobResult.json()) as any[];
  const redemptionRows = (await redemptionResult.json()) as any[];

  const clob = clobRows[0] || { cash_in: 0, cash_out: 0, net_cash: 0, event_count: 0 };
  const redemption = redemptionRows[0] || { redemption_cash: 0, event_count: 0 };

  const clob_cash_in = Number(clob.cash_in) || 0;
  const clob_cash_out = Number(clob.cash_out) || 0;
  const clob_net = Number(clob.net_cash) || 0;
  const redemption_cash = Number(redemption.redemption_cash) || 0;

  return {
    wallet: wallet.toLowerCase(),
    clob_cash_in,
    clob_cash_out,
    clob_net,
    redemption_cash,
    total_cash_pnl: clob_net + redemption_cash,
    event_count: Number(clob.event_count) + Number(redemption.event_count),
    clob_count: Number(clob.event_count),
    redemption_count: Number(redemption.event_count),
  };
}

function formatResult(r: CashPnlResult, label?: string): void {
  const displayLabel = label ? ` (${label})` : '';
  console.log(`\nWallet: ${r.wallet}${displayLabel}`);
  console.log('-'.repeat(80));
  console.log(`  CLOB:       IN $${r.clob_cash_in.toFixed(2).padStart(14)} | OUT $${r.clob_cash_out.toFixed(2).padStart(14)} | NET $${r.clob_net.toFixed(2).padStart(14)}`);
  console.log(`  Redemption: $${r.redemption_cash.toFixed(2).padStart(14)}`);
  console.log(`  -----------`);
  console.log(`  TOTAL CASH PnL: $${r.total_cash_pnl.toFixed(2)}`);
  console.log(`  Events: ${r.event_count} (CLOB: ${r.clob_count}, Redemption: ${r.redemption_count})`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage:');
    console.log('  npx tsx scripts/pnl/compute-wallet-cash-pnl.ts <wallet_address>');
    console.log('  npx tsx scripts/pnl/compute-wallet-cash-pnl.ts --known');
    console.log('');
    console.log('Known wallets:');
    for (const w of KNOWN_WALLETS) {
      console.log(`  ${w.address.substring(0, 14)}... - ${w.label}`);
    }
    process.exit(0);
  }

  console.log('='.repeat(80));
  console.log('COMPUTE WALLET CASH PnL');
  console.log('='.repeat(80));
  console.log('');
  console.log('Formula: total_cash_pnl = clob_net_cash + redemption_cash');
  console.log('  - CLOB sells add USDC (positive)');
  console.log('  - CLOB buys spend USDC (negative)');
  console.log('  - Redemptions add USDC (positive)');
  console.log('  - Splits/merges are ignored (no direct USDC impact)');

  if (args[0] === '--known') {
    // Process all known wallets
    for (const w of KNOWN_WALLETS) {
      const result = await computeWalletCashPnl(w.address);
      formatResult(result, w.label);
    }
  } else {
    // Single wallet
    const result = await computeWalletCashPnl(args[0]);
    formatResult(result);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('COMPLETE');
  console.log('='.repeat(80));
}

// Allow importing as module
export { KNOWN_WALLETS };

// Run if executed directly (not when imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch(console.error);
}
