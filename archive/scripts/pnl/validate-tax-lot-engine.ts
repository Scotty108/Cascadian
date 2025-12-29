// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env tsx
/**
 * Validate Tax Lot Engine against Theo and Sports Bettor targets
 *
 * Claude 1 - PnL Calibration
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';
import { TaxLotEngine, LedgerEvent } from './tax-lot-engine';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

const WALLETS = {
  theo: '0x56687bf447db6ffa42ffe2204a05edaa20f55839',
  sportsBettor: '0xf29bb8e0712075041e87e8605b69833ef738dd4c',
};

// Known UI targets (point-in-time snapshots)
const UI_TARGETS = {
  theo: {
    net_pnl: 22053934,
  },
  sportsBettor: {
    net_pnl: -10021172,
    gains: 28812489,
    losses: 38833660,
  },
};

async function fetchLedgerEvents(wallet: string): Promise<LedgerEvent[]> {
  console.log(`  Fetching ledger events for ${wallet.substring(0, 10)}...`);

  const result = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        position_id,
        condition_id,
        outcome_index,
        toString(event_time) as event_time,
        event_type,
        share_delta,
        cash_delta,
        fee_usdc,
        tx_hash
      FROM vw_pm_ledger_test
      WHERE wallet_address = '${wallet}'
      ORDER BY event_time, tx_hash
    `,
    format: 'JSONEachRow',
  });

  const events = await result.json() as LedgerEvent[];
  console.log(`  Found ${events.length} events`);
  return events;
}

async function validateWallet(name: string, address: string) {
  console.log(`
${'='.repeat(60)}`);
  console.log(`Validating: ${name} (${address})`);
  console.log('='.repeat(60));

  // Fetch events
  const events = await fetchLedgerEvents(address);

  // Group by position
  const byPosition = new Map<string, LedgerEvent[]>();
  for (const event of events) {
    const key = event.position_id;
    if (!byPosition.has(key)) {
      byPosition.set(key, []);
    }
    byPosition.get(key)!.push(event);
  }

  console.log(`  Unique positions: ${byPosition.size}`);

  // Run through engine
  const engine = new TaxLotEngine(address);
  engine.processEvents(events);

  // Get summary
  const summary = engine.getSummary();

  console.log(`
--- Results ---`);
  console.log(`  Realized PnL:      $${summary.total_realized_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  Gains:             $${summary.total_gains.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  Losses:            $${summary.total_losses.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  Positions:         ${summary.positions_count}`);
  console.log(`  Winning:           ${summary.winning_positions}`);
  console.log(`  Losing:            ${summary.losing_positions}`);

  // Compare to V4 total
  const v4Result = await clickhouse.query({
    query: `
      SELECT round(sum(total_pnl), 2) as v4_pnl
      FROM pm_wallet_market_pnl_v4
      WHERE lower(wallet) = '${address}'
    `,
    format: 'JSONEachRow',
  });
  const v4 = (await v4Result.json())[0] as { v4_pnl: number };

  console.log(`
--- Comparison ---`);
  console.log(`  Tax Lot Engine:    $${summary.total_realized_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  V4 (canonical):    $${Number(v4.v4_pnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  Difference:        $${(summary.total_realized_pnl - Number(v4.v4_pnl)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

  return summary;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       TAX LOT ENGINE VALIDATION                          ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const theoSummary = await validateWallet('Theo', WALLETS.theo);
  const sportsSummary = await validateWallet('Sports Bettor', WALLETS.sportsBettor);

  console.log('
' + '='.repeat(60));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(60));

  console.log('
Tax Lot Engine Results vs UI Targets:');
  console.log('
Theo:');
  console.log(`  Engine:  $${theoSummary.total_realized_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  Target:  $${UI_TARGETS.theo.net_pnl.toLocaleString()}`);

  console.log('
Sports Bettor:');
  console.log(`  Engine:  $${sportsSummary.total_realized_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  Target:  $${UI_TARGETS.sportsBettor.net_pnl.toLocaleString()}`);

  console.log('
' + '-'.repeat(60));
  console.log('NOTE: UI targets are point-in-time snapshots with open positions');
  console.log('      marked to market. Tax Lot Engine shows final realized PnL');
  console.log('      after all positions have resolved.');
  console.log('-'.repeat(60));

  await clickhouse.close();
}

main().catch(console.error);
