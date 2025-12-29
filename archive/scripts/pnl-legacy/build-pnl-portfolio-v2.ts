/**
 * Build PnL using Portfolio Value Method v2
 *
 * FIX: Account for redemptions reducing positions
 *
 * Formula: PnL = portfolio_value - cash_in
 * Where: portfolio_value = cash_out + redemptions + open_position_value
 *
 * Key insight: When you redeem, you're exchanging tokens for USDC.
 * The redemption amount is ALREADY counted in the redemptions sum.
 * We must NOT also count those tokens as open positions.
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
  payout_prices: number[];
  winning_outcome: number;
}

async function calculatePnL(wallet: string, label: string, uiPnl: number) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${label}: ${wallet.slice(0, 10)}...`);

  // Step 1: Cash in (buys)
  const buysQuery = await clickhouse.query({
    query: `
      SELECT sum(usdc) as total
      FROM (
        SELECT any(usdc_amount) / 1000000.0 AS usdc
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${wallet}' AND is_deleted = 0 AND side = 'buy'
        GROUP BY event_id
      )
    `,
    format: 'JSONEachRow'
  });
  const cashIn = Number((await buysQuery.json() as any[])[0]?.total || 0);

  // Step 2: Cash out (sells)
  const sellsQuery = await clickhouse.query({
    query: `
      SELECT sum(usdc) as total
      FROM (
        SELECT any(usdc_amount) / 1000000.0 AS usdc
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${wallet}' AND is_deleted = 0 AND side = 'sell'
        GROUP BY event_id
      )
    `,
    format: 'JSONEachRow'
  });
  const cashOut = Number((await sellsQuery.json() as any[])[0]?.total || 0);

  // Step 3: Redemptions (cash received + reduces position)
  const redemptionsQuery = await clickhouse.query({
    query: `
      SELECT
        c.condition_id,
        toFloat64OrZero(c.amount_or_payout) / 1000000.0 as redeemed_amount,
        r.payout_numerators
      FROM pm_ctf_events c
      LEFT JOIN pm_condition_resolutions r ON c.condition_id = r.condition_id AND r.is_deleted = 0
      WHERE c.user_address = '${wallet}'
        AND c.event_type = 'PayoutRedemption'
        AND c.is_deleted = 0
    `,
    format: 'JSONEachRow'
  });

  // Map: condition_id -> { outcome -> redeemed_tokens }
  const redeemed = new Map<string, Map<number, number>>();
  let totalRedemptionCash = 0;

  for (const r of await redemptionsQuery.json() as any[]) {
    totalRedemptionCash += r.redeemed_amount;

    // Determine which outcome was redeemed
    const payouts = r.payout_numerators?.replace('[', '').replace(']', '').split(',').map((x: string) => parseInt(x) || 0) || [0, 0];
    const winningOutcome = payouts[0] > 0 ? 0 : 1;

    if (!redeemed.has(r.condition_id)) {
      redeemed.set(r.condition_id, new Map());
    }
    const current = redeemed.get(r.condition_id)!.get(winningOutcome) || 0;
    redeemed.get(r.condition_id)!.set(winningOutcome, current + r.redeemed_amount);
  }

  // Step 4: Get resolutions
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
      payout_prices: [nums[0] > 0 ? 1 : 0, (nums[1] || 0) > 0 ? 1 : 0],
      winning_outcome: nums[0] > 0 ? 0 : 1
    });
  }

  // Step 5: Get positions from trades
  const positionsQuery = await clickhouse.query({
    query: `
      SELECT
        m.condition_id,
        m.outcome_index,
        sum(if(t.side = 'buy', t.tokens, -t.tokens)) as net_position
      FROM (
        SELECT event_id, any(side) AS side, any(token_id) AS token_id,
               any(token_amount) / 1000000.0 AS tokens
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${wallet}' AND is_deleted = 0
        GROUP BY event_id
      ) t
      JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      WHERE m.condition_id IS NOT NULL AND m.condition_id != ''
      GROUP BY m.condition_id, m.outcome_index
    `,
    format: 'JSONEachRow'
  });

  // Step 6: Calculate open position value (subtracting redeemed amounts)
  let openPositionValue = 0;
  let unresolvedCount = 0;

  for (const pos of await positionsQuery.json() as any[]) {
    // Subtract redeemed tokens from this position
    const redeemedForPosition = redeemed.get(pos.condition_id)?.get(pos.outcome_index) || 0;
    const actualPosition = pos.net_position - redeemedForPosition;

    if (Math.abs(actualPosition) < 0.01) continue;

    const res = resolutions.get(pos.condition_id);
    if (res) {
      const payoutPrice = res.payout_prices[pos.outcome_index] ?? 0;
      openPositionValue += actualPosition * payoutPrice;
    } else {
      unresolvedCount++;
      // Unresolved: skip (or could use mid-market)
    }
  }

  // Step 7: Calculate PnL
  const portfolioValue = cashOut + totalRedemptionCash + openPositionValue;
  const totalPnL = portfolioValue - cashIn;
  const diff = uiPnl === 0 ? 0 : ((totalPnL - uiPnl) / Math.abs(uiPnl) * 100);

  console.log(`  Cash in:             $${cashIn.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  Cash out:            $${cashOut.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  Redemptions:         $${totalRedemptionCash.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  Open position value: $${openPositionValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${unresolvedCount} unresolved)`);
  console.log(`  ────────────────────────────`);
  console.log(`  Portfolio:           $${portfolioValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  PnL:                 $${totalPnL.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  UI:                  $${uiPnl.toLocaleString()}`);
  console.log(`  Diff:                ${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`);

  return { label, totalPnL, uiPnl, diff };
}

async function main() {
  console.log('\n🔧 PnL Calculator - PORTFOLIO VALUE v2');
  console.log('='.repeat(60));
  console.log('FIX: Subtract redeemed tokens from open positions');

  try {
    const results = [];
    for (const w of WALLETS) {
      results.push(await calculatePnL(w.address, w.label, w.uiPnl));
    }

    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log('Wallet   Our PnL              UI PnL               Diff      Match');
    console.log('-'.repeat(70));

    let withinTarget = 0;
    results.forEach(r => {
      const match = Math.abs(r.diff) <= 5 ? '✓' : Math.abs(r.diff) <= 20 ? '~' : '✗';
      if (Math.abs(r.diff) <= 5) withinTarget++;
      console.log(
        `${r.label.padEnd(8)} ` +
        `$${r.totalPnL.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(17)}  ` +
        `$${r.uiPnl.toLocaleString().padStart(17)}  ` +
        `${(r.diff > 0 ? '+' : '') + r.diff.toFixed(1).padStart(6)}%  ${match}`
      );
    });

    console.log('-'.repeat(70));
    console.log(`Target: ≤5% | Achieved: ${withinTarget}/${results.length}`);

  } finally {
    await clickhouse.close();
  }
}

main().catch(console.error);
