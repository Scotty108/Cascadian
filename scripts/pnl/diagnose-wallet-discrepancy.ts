/**
 * Diagnose Wallet PnL Discrepancy
 *
 * Deep investigation into why our PnL calculations differ from Polymarket UI.
 */

import { clickhouse } from '../../lib/clickhouse/client';

interface WalletInfo {
  addr: string;
  label: string;
  uiPnl: number;
  uiVol: number;
  ourPnl: number;
}

const WALLETS: WalletInfo[] = [
  {
    addr: '0x56687bf447db6ffa42ffe2204a05edaa20f55839',
    label: 'W_22M',
    uiPnl: 22053934,
    uiVol: 43013258,
    ourPnl: -10219,
  },
  {
    addr: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
    label: 'W_97K',
    uiPnl: 96731,
    uiVol: 1383851,
    ourPnl: -10692,
  },
  {
    addr: '0xf29bb8e0712075041e87e8605b69833ef738dd4c',
    label: 'W_-10M',
    uiPnl: -10021172,
    uiVol: 150299248,
    ourPnl: -11212983,
  },
];

async function diagnoseWallet(w: WalletInfo): Promise<void> {
  console.log('\n' + '═'.repeat(80));
  console.log(`${w.label}: ${w.addr}`);
  console.log('═'.repeat(80));
  console.log(`UI PnL: $${w.uiPnl.toLocaleString()} | Our PnL: $${w.ourPnl.toLocaleString()}`);
  console.log(`Gap: $${(w.uiPnl - w.ourPnl).toLocaleString()}`);
  console.log('─'.repeat(80));

  // 1. CLOB trades breakdown by side
  const clobResult = await clickhouse.query({
    query: `
      SELECT
        side,
        count() as total_rows,
        countDistinct(event_id) as unique_events,
        sum(usdc_amount) / 1e6 as total_usdc,
        sum(token_amount) / 1e6 as total_tokens
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String} AND is_deleted = 0
      GROUP BY side
    `,
    query_params: { wallet: w.addr },
    format: 'JSONEachRow',
  });
  const clob = (await clobResult.json()) as Array<{
    side: string;
    total_rows: number;
    unique_events: number;
    total_usdc: number;
    total_tokens: number;
  }>;

  console.log('\n1. CLOB TRADES:');
  let totalBuyUsdc = 0;
  let totalSellUsdc = 0;
  let totalBuyTokens = 0;
  let totalSellTokens = 0;

  for (const row of clob) {
    console.log(
      `   ${row.side}: ${row.unique_events} events, $${row.total_usdc.toLocaleString()} USDC, ${row.total_tokens.toLocaleString()} tokens`
    );
    if (row.side === 'BUY') {
      totalBuyUsdc = row.total_usdc;
      totalBuyTokens = row.total_tokens;
    } else {
      totalSellUsdc = row.total_usdc;
      totalSellTokens = row.total_tokens;
    }
  }

  const netCashflow = totalSellUsdc - totalBuyUsdc;
  const netTokens = totalBuyTokens - totalSellTokens;
  console.log(`   Net Cashflow (Sells - Buys): $${netCashflow.toLocaleString()}`);
  console.log(`   Net Tokens (Buys - Sells): ${netTokens.toLocaleString()}`);

  // 2. CTF Events (splits, merges, redemptions)
  const ctfResult = await clickhouse.query({
    query: `
      SELECT
        event_type,
        count() as cnt,
        sum(toFloat64OrZero(amount_or_payout)) / 1e6 as total_amount
      FROM pm_ctf_events
      WHERE user_address = {wallet:String} AND is_deleted = 0
      GROUP BY event_type
      ORDER BY cnt DESC
    `,
    query_params: { wallet: w.addr },
    format: 'JSONEachRow',
  });
  const ctf = (await ctfResult.json()) as Array<{
    event_type: string;
    cnt: number;
    total_amount: number;
  }>;

  console.log('\n2. CTF EVENTS:');
  let totalRedemptionPayout = 0;
  for (const e of ctf) {
    console.log(`   ${e.event_type}: ${e.cnt} events, ${e.total_amount.toLocaleString()} amount`);
    if (e.event_type === 'REDEMPTION') {
      totalRedemptionPayout = e.total_amount;
    }
  }

  // 3. ERC1155 Transfers
  const xferResult = await clickhouse.query({
    query: `
      SELECT
        if(to_address = {wallet:String}, 'IN', 'OUT') as direction,
        count() as cnt,
        sum(toFloat64OrZero(value)) / 1e6 as total_tokens
      FROM pm_erc1155_transfers
      WHERE (from_address = {wallet:String} OR to_address = {wallet:String})
        AND is_deleted = 0
      GROUP BY direction
    `,
    query_params: { wallet: w.addr },
    format: 'JSONEachRow',
  });
  const xfers = (await xferResult.json()) as Array<{
    direction: string;
    cnt: number;
    total_tokens: number;
  }>;

  console.log('\n3. ERC1155 TRANSFERS:');
  for (const x of xfers) {
    console.log(`   ${x.direction}: ${x.cnt} events, ${x.total_tokens.toLocaleString()} tokens`);
  }

  // 4. Sample some trades to verify data
  console.log('\n4. SAMPLE TRADES (first 5):');
  const sampleResult = await clickhouse.query({
    query: `
      SELECT
        event_id,
        side,
        usdc_amount / 1e6 as usdc,
        token_amount / 1e6 as tokens,
        trade_time
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String} AND is_deleted = 0
      ORDER BY trade_time
      LIMIT 5
    `,
    query_params: { wallet: w.addr },
    format: 'JSONEachRow',
  });
  const samples = (await sampleResult.json()) as Array<{
    event_id: string;
    side: string;
    usdc: number;
    tokens: number;
    trade_time: string;
  }>;

  for (const s of samples) {
    console.log(`   ${s.trade_time} | ${s.side} | $${s.usdc.toFixed(2)} | ${s.tokens.toFixed(2)} tokens`);
  }

  // 5. Check if redemptions give us the payout value correctly
  console.log('\n5. REDEMPTION DETAILS (sample):');
  const redemptionSample = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        event_type,
        amount_or_payout,
        event_timestamp
      FROM pm_ctf_events
      WHERE user_address = {wallet:String}
        AND event_type = 'REDEMPTION'
        AND is_deleted = 0
      ORDER BY event_timestamp DESC
      LIMIT 3
    `,
    query_params: { wallet: w.addr },
    format: 'JSONEachRow',
  });
  const redemptions = (await redemptionSample.json()) as Array<{
    condition_id: string;
    event_type: string;
    amount_or_payout: string;
    event_timestamp: string;
  }>;

  for (const r of redemptions) {
    const amount = parseFloat(r.amount_or_payout) / 1e6;
    console.log(`   ${r.condition_id.substring(0, 16)}... | $${amount.toFixed(2)} payout`);
  }

  // 6. Calculate simple PnL estimate
  console.log('\n6. SIMPLE PNL ESTIMATE:');
  const simplePnl = netCashflow + totalRedemptionPayout;
  console.log(`   Net Cashflow (sells - buys): $${netCashflow.toLocaleString()}`);
  console.log(`   + Redemption Payouts: $${totalRedemptionPayout.toLocaleString()}`);
  console.log(`   = Simple PnL Estimate: $${simplePnl.toLocaleString()}`);
  console.log(`   UI PnL: $${w.uiPnl.toLocaleString()}`);
  console.log(`   Difference: $${(w.uiPnl - simplePnl).toLocaleString()}`);
}

async function main(): Promise<void> {
  console.log('═'.repeat(80));
  console.log('WALLET PNL DISCREPANCY DIAGNOSIS');
  console.log('═'.repeat(80));

  for (const w of WALLETS) {
    await diagnoseWallet(w);
  }

  console.log('\n' + '═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));
  console.log('\nPossible causes for discrepancy:');
  console.log('1. Redemption payout calculation (are we parsing amount_or_payout correctly?)');
  console.log('2. Unrealized PnL on open positions (UI may include mark-to-market)');
  console.log('3. Missing data sources (FPMM/AMM trades? Legacy contracts?)');
  console.log('4. avgPrice weighted average not matching (accumulation error)');
  console.log('5. ERC1155 transfer handling differences');
}

main().catch(console.error);
