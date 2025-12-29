/**
 * Build PnL using Portfolio Value Method
 *
 * BREAKTHROUGH: The UI formula is actually simple:
 *   PnL = current_portfolio_value - total_invested
 *       = (cash_out + redemptions + open_position_value) - cash_in
 *
 * Where open_position_value = sum(position_size × current_price)
 * - current_price = payout_price ($1 or $0) for resolved markets
 * - current_price = market_price for unresolved (we skip or use cost basis)
 *
 * Terminal: Claude 3
 * Date: 2025-11-26
 */

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'Lbr.jYtw5ikf3',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

// Test wallets
const WALLETS = [
  { address: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', label: 'WHALE', uiPnl: 22053934 },
  { address: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', label: 'EGG', uiPnl: 95976 },
  { address: '0xf29bb8e0712075041e87e8605b69833ef738dd4c', label: 'NEW', uiPnl: -10021172 },
  { address: '0x9d36c904930a7d06c5403f9e16996e919f586486', label: 'W1', uiPnl: -6138.90 },
  { address: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', label: 'W2', uiPnl: 4404.92 },
  { address: '0x418db17eaa8f25eaf2085657d0becd82462c6786', label: 'W3', uiPnl: 5.44 },
  { address: '0x4974d02a2e6ca79b33f6e915e98f5a8cc5237fdb', label: 'W4', uiPnl: -294.61 },
  { address: '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2', label: 'W5', uiPnl: 146.90 },
  { address: '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d', label: 'W6', uiPnl: 470.40 },
];

interface Resolution {
  payout_prices: number[];  // [outcome_0_payout, outcome_1_payout]
}

async function calculatePortfolioValuePnL(wallet: string, label: string, uiPnl: number) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${label}: ${wallet.slice(0, 10)}...`);

  // Step 1: Get total cash invested (buys)
  const buysQuery = await clickhouse.query({
    query: `
      SELECT sum(usdc) as total
      FROM (
        SELECT any(usdc_amount) / 1000000.0 AS usdc
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${wallet}'
          AND is_deleted = 0
          AND side = 'buy'
        GROUP BY event_id
      )
    `,
    format: 'JSONEachRow'
  });
  const cashIn = Number((await buysQuery.json() as any[])[0]?.total || 0);

  // Step 2: Get total cash received (sells)
  const sellsQuery = await clickhouse.query({
    query: `
      SELECT sum(usdc) as total
      FROM (
        SELECT any(usdc_amount) / 1000000.0 AS usdc
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${wallet}'
          AND is_deleted = 0
          AND side = 'sell'
        GROUP BY event_id
      )
    `,
    format: 'JSONEachRow'
  });
  const cashOut = Number((await sellsQuery.json() as any[])[0]?.total || 0);

  // Step 3: Get redemptions
  const redemptionsQuery = await clickhouse.query({
    query: `
      SELECT sum(toFloat64OrZero(amount_or_payout) / 1000000.0) as total
      FROM pm_ctf_events
      WHERE user_address = '${wallet}'
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const redemptions = Number((await redemptionsQuery.json() as any[])[0]?.total || 0);

  // Step 4: Get current positions
  const positionsQuery = await clickhouse.query({
    query: `
      SELECT
        m.condition_id,
        m.outcome_index,
        sum(if(t.side = 'buy', t.tokens, -t.tokens)) as net_position
      FROM (
        SELECT
          event_id,
          any(side) AS side,
          any(token_id) AS token_id,
          any(token_amount) / 1000000.0 AS tokens
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${wallet}' AND is_deleted = 0
        GROUP BY event_id
      ) t
      JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      WHERE m.condition_id IS NOT NULL AND m.condition_id != ''
      GROUP BY m.condition_id, m.outcome_index
      HAVING abs(net_position) > 0.01
    `,
    format: 'JSONEachRow'
  });
  const positions = await positionsQuery.json() as any[];

  // Step 5: Get resolutions
  const resolutionsQuery = await clickhouse.query({
    query: `
      SELECT condition_id, payout_numerators
      FROM pm_condition_resolutions
      WHERE is_deleted = 0 AND payout_denominator != '' AND payout_denominator != '0'
    `,
    format: 'JSONEachRow'
  });
  const resolutions = new Map<string, Resolution>();
  for (const r of await resolutionsQuery.json() as any[]) {
    const nums = r.payout_numerators.replace('[', '').replace(']', '').split(',').map((x: string) => parseInt(x) || 0);
    resolutions.set(r.condition_id, {
      payout_prices: [nums[0] > 0 ? 1 : 0, (nums[1] || 0) > 0 ? 1 : 0]
    });
  }

  // Step 6: Calculate open position value
  let resolvedLongValue = 0;
  let resolvedShortValue = 0;
  let unresolvedCount = 0;

  for (const pos of positions) {
    const res = resolutions.get(pos.condition_id);

    if (res) {
      // Resolved: value at payout price
      const payoutPrice = res.payout_prices[pos.outcome_index] ?? 0;

      if (pos.net_position > 0) {
        // Long position: worth payout_price × position
        resolvedLongValue += pos.net_position * payoutPrice;
      } else {
        // Short position: liability at payout price (if payout=1, we owe; if payout=0, we keep proceeds)
        // Short value = -position × payout (negative because it's a liability)
        resolvedShortValue += pos.net_position * payoutPrice; // net_position is negative, so this subtracts
      }
    } else {
      // Unresolved: we could use mid-market price, but for now skip (or use 0)
      unresolvedCount++;
    }
  }

  const openPositionValue = resolvedLongValue + resolvedShortValue;

  // Step 7: Calculate total portfolio value and PnL
  const totalPortfolioValue = cashOut + redemptions + openPositionValue;
  const totalPnL = totalPortfolioValue - cashIn;
  const diff = uiPnl === 0 ? 0 : ((totalPnL - uiPnl) / Math.abs(uiPnl) * 100);

  console.log(`  Cash in (buys):      $${cashIn.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  Cash out (sells):    $${cashOut.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  Redemptions:         $${redemptions.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  Open position value: $${openPositionValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${unresolvedCount} unresolved)`);
  console.log(`  ────────────────────────────`);
  console.log(`  Portfolio value:     $${totalPortfolioValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  PnL:                 $${totalPnL.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  UI PnL:              $${uiPnl.toLocaleString()}`);
  console.log(`  Diff:                ${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`);

  return { label, totalPnL, uiPnl, diff };
}

async function main() {
  console.log('\n🔧 PnL Calculator - PORTFOLIO VALUE METHOD');
  console.log('='.repeat(60));
  console.log('Formula: PnL = (cash_out + redemptions + open_value) - cash_in');
  console.log('Open position value = position × payout_price for resolved markets');

  try {
    const results = [];

    for (const w of WALLETS) {
      results.push(await calculatePortfolioValuePnL(w.address, w.label, w.uiPnl));
    }

    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY - Portfolio Value Method');
    console.log('='.repeat(70));
    console.log('Wallet   Our PnL              UI PnL               Diff      Match');
    console.log('-'.repeat(70));

    let withinTarget = 0;
    results.forEach(r => {
      const match = Math.abs(r.diff) <= 5 ? '✓ YES' : Math.abs(r.diff) <= 20 ? '~ CLOSE' : '✗ NO';
      if (Math.abs(r.diff) <= 5) withinTarget++;
      console.log(
        `${r.label.padEnd(8)} ` +
        `$${r.totalPnL.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(17)}  ` +
        `$${r.uiPnl.toLocaleString().padStart(17)}  ` +
        `${(r.diff > 0 ? '+' : '') + r.diff.toFixed(1).padStart(6)}%  ${match}`
      );
    });

    console.log('-'.repeat(70));
    console.log(`Target: ≤5% difference | Achieved: ${withinTarget}/${results.length} wallets`);

  } finally {
    await clickhouse.close();
  }
}

main().catch(console.error);
