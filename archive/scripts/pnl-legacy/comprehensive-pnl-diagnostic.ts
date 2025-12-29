#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@clickhouse/client';

config({ path: resolve(__dirname, '../.env.local') });

const TARGET_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

async function main() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('         COMPREHENSIVE P&L DIAGNOSTIC REPORT');
  console.log('═══════════════════════════════════════════════════════\n');

  // 1. Total cashflow (money spent/received)
  const cashflow = await clickhouse.query({
    query: `
      SELECT
        sum(gross_cf) as total_cashflow,
        sum(fees) as total_fees,
        sum(gross_cf) - sum(fees) as net_cashflow
      FROM wallet_token_flows
      WHERE lower(wallet) = lower('${TARGET_WALLET}')
    `,
    format: 'JSONEachRow',
  });
  const cfData = await cashflow.json();
  console.log('1. CASHFLOW ANALYSIS:');
  console.log(JSON.stringify(cfData, null, 2));

  // 2. Payout breakdown
  const payouts = await clickhouse.query({
    query: `
      SELECT
        countIf(realized_payout > 0) as winning_tokens,
        countIf(realized_payout = 0) as non_winning_tokens,
        sum(realized_payout) as total_payout,
        sum(pnl_gross) as total_pnl_gross,
        sum(pnl_net) as total_pnl_net
      FROM wallet_condition_pnl_token
      WHERE lower(wallet) = lower('${TARGET_WALLET}')
    `,
    format: 'JSONEachRow',
  });
  const payoutData = await payouts.json();
  console.log('\n2. PAYOUT BREAKDOWN:');
  console.log(JSON.stringify(payoutData, null, 2));

  // 3. Sample winning positions
  const winners = await clickhouse.query({
    query: `
      SELECT
        condition_id_ctf,
        index_set_mask,
        net_shares,
        gross_cf,
        realized_payout,
        pnl_gross
      FROM wallet_condition_pnl_token
      WHERE lower(wallet) = lower('${TARGET_WALLET}')
        AND realized_payout > 0
      ORDER BY realized_payout DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const winnerData = await winners.json();
  console.log('\n3. TOP 10 WINNING POSITIONS:');
  console.log(JSON.stringify(winnerData, null, 2));

  // 4. Check for unresolved positions
  const unresolved = await clickhouse.query({
    query: `
      SELECT
        f.condition_id_ctf,
        f.index_set_mask,
        f.net_shares,
        f.gross_cf,
        t.pps
      FROM wallet_token_flows f
      LEFT JOIN token_per_share_payout t USING (condition_id_ctf)
      WHERE lower(f.wallet) = lower('${TARGET_WALLET}')
        AND (t.pps IS NULL OR length(t.pps) = 0)
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const unresolvedData = await unresolved.json();
  console.log('\n4. UNRESOLVED POSITIONS (sample):');
  console.log(JSON.stringify(unresolvedData, null, 2));

  // 5. Final numbers
  const final = await clickhouse.query({
    query: `
      SELECT
        pnl_gross,
        pnl_net
      FROM wallet_realized_pnl
      WHERE lower(wallet) = lower('${TARGET_WALLET}')
    `,
    format: 'JSONEachRow',
  });
  const finalData = await final.json();
  console.log('\n5. FINAL P&L:');
  console.log(JSON.stringify(finalData, null, 2));

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('                   ANALYSIS SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  
  const cf = cfData[0] as any;
  const po = payoutData[0] as any;
  const fn = finalData[0] as any;
  
  console.log(`\nMoney spent (gross_cf):    $${parseFloat(cf.total_cashflow).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
  console.log(`Fees paid:                 $${parseFloat(cf.total_fees).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
  console.log(`Payouts received:          $${parseFloat(po.total_payout).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
  console.log(`Winning tokens:            ${po.winning_tokens}`);
  console.log(`Non-winning tokens:        ${po.non_winning_tokens}`);
  console.log(`───────────────────────────────────────────────────────`);
  console.log(`Calculated P&L (gross):    $${parseFloat(fn.pnl_gross).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
  console.log(`Calculated P&L (net):      $${parseFloat(fn.pnl_net).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
  console.log(`Target P&L (DOME):         $87,030.51`);
  console.log(`Gap:                       $${(87030.51 - parseFloat(fn.pnl_net)).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
  console.log('\n');

  await clickhouse.close();
}

main();
