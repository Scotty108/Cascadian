/**
 * Quick test of V20 engine against a wallet
 * Usage: npx tsx scripts/pnl/quick-test-wallet.ts <wallet>
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getWalletPnl, getWalletPnlQuick } from '../../lib/pnl/getWalletPnl';
import { calculateV20PnL } from '../../lib/pnl/uiActivityEngineV20';
import { clickhouse } from '../../lib/clickhouse/client';

const DEFAULT_WALLET = '0x82a1b239e7e0ff25a2ac12a20b59fd6b5f90e03a'; // darkrider11

async function main() {
  const wallet = process.argv[2] || DEFAULT_WALLET;
  console.log(`\n=== Quick PnL Test for ${wallet} ===\n`);

  // Test 1: V20 Quick PnL
  console.log('1. V20 Engine (canonical):');
  try {
    const v20Result = await calculateV20PnL(wallet);
    console.log(`   Total PnL:      $${v20Result.total_pnl.toLocaleString()}`);
    console.log(`   Realized PnL:   $${v20Result.realized_pnl.toLocaleString()}`);
    console.log(`   Unrealized PnL: $${v20Result.unrealized_pnl.toLocaleString()}`);
    console.log(`   Positions:      ${v20Result.positions}`);
    console.log(`   Resolved:       ${v20Result.resolved}`);
  } catch (e) {
    console.log(`   ERROR: ${e}`);
  }

  // Test 2: Check what tables exist
  console.log('\n2. Data Source Check:');

  // Check pm_unified_ledger_v7
  try {
    const v7Check = await clickhouse.query({
      query: `SELECT count() as cnt FROM pm_unified_ledger_v7 WHERE lower(wallet_address) = lower('${wallet}')`,
      format: 'JSONEachRow'
    });
    const v7Rows = await v7Check.json() as any[];
    console.log(`   pm_unified_ledger_v7: ${v7Rows[0]?.cnt || 0} rows`);
  } catch (e) {
    console.log(`   pm_unified_ledger_v7: NOT FOUND or ERROR`);
  }

  // Check pm_unified_ledger_v8_tbl (canonical full ledger)
  try {
    const v8Check = await clickhouse.query({
      query: `SELECT count() as cnt FROM pm_unified_ledger_v8_tbl WHERE lower(wallet_address) = lower('${wallet}')`,
      format: 'JSONEachRow'
    });
    const v8Rows = await v8Check.json() as any[];
    console.log(`   pm_unified_ledger_v8_tbl: ${v8Rows[0]?.cnt || 0} rows`);
  } catch (e) {
    console.log(`   pm_unified_ledger_v8_tbl: NOT FOUND or ERROR`);
  }

  // Check pm_unified_ledger_v9_clob_tbl (canonical CLOB ledger)
  try {
    const v9Check = await clickhouse.query({
      query: `SELECT count() as cnt FROM pm_unified_ledger_v9_clob_tbl WHERE lower(wallet_address) = lower('${wallet}')`,
      format: 'JSONEachRow'
    });
    const v9Rows = await v9Check.json() as any[];
    console.log(`   pm_unified_ledger_v9_clob_tbl: ${v9Rows[0]?.cnt || 0} rows`);
  } catch (e) {
    console.log(`   pm_unified_ledger_v9_clob_tbl: NOT FOUND or ERROR`);
  }

  // Check pm_trader_events_v2 (raw CLOB events)
  try {
    const rawCheck = await clickhouse.query({
      query: `
        SELECT count() as cnt, countDistinct(event_id) as distinct_events
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
      `,
      format: 'JSONEachRow'
    });
    const rawRows = await rawCheck.json() as any[];
    console.log(`   pm_trader_events_v2: ${rawRows[0]?.cnt || 0} rows (${rawRows[0]?.distinct_events || 0} distinct events)`);
  } catch (e) {
    console.log(`   pm_trader_events_v2: NOT FOUND or ERROR`);
  }

  // Test 3: Simple cash flow check (sell - buy)
  console.log('\n3. Simple Cash Flow (from pm_trader_events_v2):');
  try {
    const cashQuery = await clickhouse.query({
      query: `
        WITH deduped AS (
          SELECT
            event_id,
            any(side) as side,
            any(usdc_amount) / 1000000.0 as usdc
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
          GROUP BY event_id
        )
        SELECT
          sum(if(side = 'SELL', usdc, 0)) as total_sell,
          sum(if(side = 'BUY', usdc, 0)) as total_buy,
          sum(if(side = 'SELL', usdc, -usdc)) as net_cash
        FROM deduped
      `,
      format: 'JSONEachRow'
    });
    const cashRows = await cashQuery.json() as any[];
    console.log(`   Total SELL: $${Number(cashRows[0]?.total_sell || 0).toLocaleString()}`);
    console.log(`   Total BUY:  $${Number(cashRows[0]?.total_buy || 0).toLocaleString()}`);
    console.log(`   Net Cash:   $${Number(cashRows[0]?.net_cash || 0).toLocaleString()}`);
  } catch (e) {
    console.log(`   ERROR: ${e}`);
  }

  // Test 4: Check pm_wallet_realized_pnl_hc_v1 (the problematic export table)
  console.log('\n4. HC Export Table (pm_wallet_realized_pnl_hc_v1):');
  try {
    const hcQuery = await clickhouse.query({
      query: `
        SELECT
          realized_pnl,
          is_hc,
          buy_usdc,
          sell_usdc,
          redemption_payout
        FROM pm_wallet_realized_pnl_hc_v1
        WHERE lower(wallet) = lower('${wallet}')
      `,
      format: 'JSONEachRow'
    });
    const hcRows = await hcQuery.json() as any[];
    if (hcRows.length > 0) {
      console.log(`   realized_pnl: $${Number(hcRows[0]?.realized_pnl || 0).toLocaleString()}`);
      console.log(`   is_hc: ${hcRows[0]?.is_hc}`);
      console.log(`   buy_usdc: $${Number(hcRows[0]?.buy_usdc || 0).toLocaleString()}`);
      console.log(`   sell_usdc: $${Number(hcRows[0]?.sell_usdc || 0).toLocaleString()}`);
      console.log(`   redemption_payout: $${Number(hcRows[0]?.redemption_payout || 0).toLocaleString()}`);
    } else {
      console.log(`   NOT FOUND in HC table`);
    }
  } catch (e) {
    console.log(`   ERROR: ${e}`);
  }

  console.log('\n=== Expected UI Value ===');
  console.log('darkrider11 (@darkrider11): ~$604,472 (from Polymarket profile)\n');
}

main().catch(console.error);
