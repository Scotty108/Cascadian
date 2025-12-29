#!/usr/bin/env npx tsx
/**
 * Regression Summary V1 - Calculate PnL for 7 wallets and compare to UI
 *
 * Formula: PnL = sum(cash_flow_usdc) + sum(net_shares * resolution_price)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000,
});

// UI values from Playwright scraping
const UI_VALUES: Record<string, { net_total: number; gain?: number; loss?: number }> = {
  '0xadb7696bd58f5faddf23e85776b5f68fba65c02c': { net_total: -1592.95 },
  '0xf9fc56e10121f20e69bb496b0b1a4b277dec4bf2': { net_total: 1618.24 },
  '0xf70acdab62c5d2fcf3f411ae6b4ebd459d19a191': { net_total: 40.42, gain: 697.55, loss: -657.12 },
  '0x13cb83542f2e821b117606aef235a7c6cb7e4ad1': { net_total: 8.72 },
  '0x46e669b5f53bfa7d8ff438a228dd06159ec0a3a1': { net_total: -4.77, gain: 7.27, loss: -12.03 },
  '0x88cee1fe5e14407927029b6cff5ad0fc4613d70e': { net_total: -67.54, gain: 49.27, loss: -116.81 },
  '0x1e8d211976903f2f5bc4e7908fcbafe07b3e4bd2': { net_total: 4160.93 },
};

interface WalletResult {
  wallet: string;
  tradeCashFlow: number;
  ctfCashFlow: number;
  settlementValue: number;
  unresolvedShares: number;
  calculatedPnl: number;
  uiPnl: number;
  delta: number;
  deltaPercent: number;
  notes: string[];
}

async function calculateWalletPnl(wallet: string): Promise<WalletResult> {
  const notes: string[] = [];

  // Step 1: Get trade cash flow
  const tradeQuery = await clickhouse.query({
    query: `
      SELECT sum(cash_flow_usdc) as cash_flow
      FROM pm_regression_ledger_v1
      WHERE wallet = '${wallet}' AND event_type = 'TRADE'
    `,
    format: 'JSONEachRow'
  });
  const tradeResult = await tradeQuery.json() as any[];
  const tradeCashFlow = tradeResult[0]?.cash_flow || 0;

  // Step 2: Get CTF cash flow (redemptions)
  const ctfQuery = await clickhouse.query({
    query: `
      SELECT sum(cash_flow_usdc) as cash_flow
      FROM pm_regression_ledger_v1
      WHERE wallet = '${wallet}' AND event_type = 'REDEEM'
    `,
    format: 'JSONEachRow'
  });
  const ctfResult = await ctfQuery.json() as any[];
  const ctfCashFlow = ctfResult[0]?.cash_flow || 0;

  // Step 3: Get per-token positions and calculate settlement value
  const positionsQuery = await clickhouse.query({
    query: `
      SELECT
        token_id,
        sum(delta_shares) as net_shares,
        sum(cash_flow_usdc) as cash_flow
      FROM pm_regression_ledger_v1
      WHERE wallet = '${wallet}' AND token_id NOT LIKE '0x%'
      GROUP BY token_id
    `,
    format: 'JSONEachRow'
  });
  const positions = await positionsQuery.json() as any[];

  let settlementValue = 0;
  let unresolvedShares = 0;

  for (const pos of positions) {
    // Get resolution price via mapping
    const mappingQuery = await clickhouse.query({
      query: `
        SELECT DISTINCT condition_id, outcome_index
        FROM vw_pm_ledger
        WHERE token_id = '${pos.token_id}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });
    const mapping = await mappingQuery.json() as any[];

    if (mapping.length === 0) {
      notes.push(`No mapping for token ${pos.token_id.slice(0, 20)}...`);
      continue;
    }

    const { condition_id, outcome_index } = mapping[0];

    // Get resolution price
    const resQuery = await clickhouse.query({
      query: `
        SELECT resolved_price
        FROM vw_pm_resolution_prices
        WHERE condition_id = '${condition_id}' AND outcome_index = ${outcome_index}
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });
    const resResult = await resQuery.json() as any[];

    if (resResult.length > 0) {
      const resolvedPrice = resResult[0].resolved_price;
      const tokenSettlement = pos.net_shares * resolvedPrice;
      settlementValue += tokenSettlement;
    } else {
      // Unresolved position
      unresolvedShares += Math.abs(pos.net_shares);
    }
  }

  const totalCashFlow = tradeCashFlow + ctfCashFlow;
  const calculatedPnl = totalCashFlow + settlementValue;
  const uiPnl = UI_VALUES[wallet]?.net_total || 0;
  const delta = calculatedPnl - uiPnl;
  const deltaPercent = uiPnl !== 0 ? (delta / Math.abs(uiPnl)) * 100 : 0;

  return {
    wallet,
    tradeCashFlow,
    ctfCashFlow,
    settlementValue,
    unresolvedShares,
    calculatedPnl,
    uiPnl,
    delta,
    deltaPercent,
    notes
  };
}

async function main() {
  console.log('='.repeat(120));
  console.log('REGRESSION SUMMARY V1 - PNL CALCULATION FOR 7 WALLETS');
  console.log('Formula: PnL = trade_cash_flow + ctf_cash_flow + settlement_value');
  console.log('='.repeat(120));
  console.log();

  const wallets = Object.keys(UI_VALUES);
  const results: WalletResult[] = [];

  for (const wallet of wallets) {
    console.log(`Processing ${wallet.slice(0, 10)}...`);
    const result = await calculateWalletPnl(wallet);
    results.push(result);
  }

  // Summary table
  console.log('\n' + '='.repeat(120));
  console.log('SUMMARY');
  console.log('='.repeat(120));
  console.log('Wallet (10 chars) | Trade CF   | CTF CF     | Settle Val | Unresolved | Calc PnL   | UI PnL     | Delta      | %');
  console.log('-'.repeat(120));

  let totalPass = 0;
  let totalFail = 0;

  for (const r of results) {
    const threshold = Math.abs(r.uiPnl) > 500 ? 25 : 5;
    const pass = Math.abs(r.delta) <= threshold && (r.calculatedPnl >= 0) === (r.uiPnl >= 0);

    if (pass) totalPass++;
    else totalFail++;

    const status = pass ? '✅' : '❌';

    console.log(
      r.wallet.slice(0, 10).padEnd(17) + ' | ' +
      `$${r.tradeCashFlow.toFixed(2)}`.padStart(10) + ' | ' +
      `$${r.ctfCashFlow.toFixed(2)}`.padStart(10) + ' | ' +
      `$${r.settlementValue.toFixed(2)}`.padStart(10) + ' | ' +
      `${r.unresolvedShares.toFixed(0)}`.padStart(10) + ' | ' +
      `$${r.calculatedPnl.toFixed(2)}`.padStart(10) + ' | ' +
      `$${r.uiPnl.toFixed(2)}`.padStart(10) + ' | ' +
      `$${r.delta.toFixed(2)}`.padStart(10) + ' | ' +
      `${r.deltaPercent.toFixed(1)}%`.padStart(6) + ' ' + status
    );
  }

  console.log('-'.repeat(120));
  console.log(`RESULTS: ${totalPass} PASS, ${totalFail} FAIL out of ${results.length} wallets`);

  // Detailed analysis for failing wallets
  console.log('\n' + '='.repeat(120));
  console.log('ANALYSIS OF FAILING WALLETS');
  console.log('='.repeat(120));

  for (const r of results) {
    const threshold = Math.abs(r.uiPnl) > 500 ? 25 : 5;
    const pass = Math.abs(r.delta) <= threshold && (r.calculatedPnl >= 0) === (r.uiPnl >= 0);

    if (!pass) {
      console.log(`\n--- ${r.wallet} ---`);
      console.log(`  Calculated: $${r.calculatedPnl.toFixed(2)}`);
      console.log(`  UI:         $${r.uiPnl.toFixed(2)}`);
      console.log(`  Delta:      $${r.delta.toFixed(2)} (${r.deltaPercent.toFixed(1)}%)`);
      console.log(`  Unresolved: ${r.unresolvedShares.toFixed(0)} shares`);
      if (r.notes.length > 0) {
        console.log('  Notes:');
        r.notes.forEach(n => console.log(`    - ${n}`));
      }

      // Possible causes
      console.log('  Possible causes:');
      if (r.unresolvedShares > 0) {
        console.log('    - Has unresolved positions (market not settled yet)');
      }
      if (r.ctfCashFlow === 0) {
        console.log('    - No CTF redemption data captured');
      }
      if (Math.abs(r.delta) > 500) {
        console.log('    - Large discrepancy - likely missing major data source');
      }
    }
  }

  await clickhouse.close();
}

main().catch(console.error);
