/**
 * Debug the 3 failing CLOB-only wallets
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV1 } from '../lib/pnl/pnlEngineV1';
import { clickhouse } from '../lib/clickhouse/client';

const WALLETS = [
  { wallet: '0x583537b26372c4527ff0eb9766da22fb6ab038cd', name: 'mixed_1', pm: -0.08 },
  { wallet: '0xf380061e3ef5fa4d46341b269f75d57d6dc6c8b0', name: 'spot_6', pm: -37 },
  { wallet: '0x045b5748b78efe2988e4574fe362cf91a3ea1d11', name: 'spot_7', pm: -10 },
];

async function getCLOBSummary(wallet: string) {
  const query = `
    SELECT
      side,
      count() as trades,
      sum(usdc_amount) / 1e6 as total_usdc,
      sum(token_amount) / 1e6 as total_tokens
    FROM pm_trader_events_v3
    WHERE lower(trader_wallet) = '${wallet.toLowerCase()}'
    GROUP BY side
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return await result.json();
}

async function getRedemptionDetails(wallet: string) {
  const query = `
    SELECT
      lower(condition_id) as condition_id,
      partition_index_sets,
      toFloat64OrZero(amount_or_payout) / 1e6 as amount
    FROM pm_ctf_events
    WHERE lower(user_address) = '${wallet.toLowerCase()}'
      AND event_type = 'PayoutRedemption'
      AND is_deleted = 0
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return await result.json();
}

async function main() {
  for (const { wallet, name, pm } of WALLETS) {
    console.log('═'.repeat(80));
    console.log(`${name} (${wallet.slice(0, 10)}...)`);
    console.log('═'.repeat(80));

    // Get V1 result
    const v1 = await getWalletPnLV1(wallet);
    console.log(`\nPolymarket: $${pm}`);
    console.log(`V1 Total: $${v1.total.toFixed(2)}`);
    console.log(`V1 Realized: $${v1.realized.pnl.toFixed(2)}`);
    console.log(`V1 Synthetic: $${v1.syntheticRealized.pnl.toFixed(2)}`);
    console.log(`V1 Unrealized: $${v1.unrealized.pnl.toFixed(2)}`);

    // Get CLOB summary
    console.log('\nCLOB Activity:');
    const clob = await getCLOBSummary(wallet) as any[];
    for (const row of clob) {
      console.log(`  ${row.side}: ${row.trades} trades, $${Number(row.total_usdc).toFixed(2)} USDC, ${Number(row.total_tokens).toFixed(2)} tokens`);
    }

    // Get redemption details
    const redemptions = await getRedemptionDetails(wallet) as any[];
    if (redemptions.length > 0) {
      console.log(`\nRedemptions (${redemptions.length}):`);
      for (const r of redemptions.slice(0, 5)) {
        console.log(`  ${r.condition_id.slice(0, 16)}... ${r.partition_index_sets}: ${r.amount} tokens`);
      }
      if (redemptions.length > 5) {
        console.log(`  ... and ${redemptions.length - 5} more`);
      }
    }

    console.log('');
  }
}

main().catch(console.error);
