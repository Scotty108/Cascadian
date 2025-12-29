/**
 * Build PnL using WAC State Machine (v2)
 *
 * Following official Polymarket methodology from pnl-subgraph:
 * - Redemptions treated as SELLS at payout price (not separate term)
 * - avgPrice updated only on BUYs
 * - realized_pnl = effective_amount * (sell_price - avg_price)
 * - unrealized_pnl = amount * (current_price - avg_price)
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

// Test wallets - original 3
const WHALE = '0x56687bf447db6ffa42ffe2204a05edaa20f55839';
const EGG = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const NEW = '0xf29bb8e0712075041e87e8605b69833ef738dd4c';

// Additional test wallets from previous session
const WALLET_1 = '0x9d36c904930a7d06c5403f9e16996e919f586486'; // UI: -$6,138.90
const WALLET_2 = '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838'; // UI: +$4,404.92 (was GOOD)
const WALLET_3 = '0x418db17eaa8f25eaf2085657d0becd82462c6786'; // UI: +$5.44
const WALLET_4 = '0x4974d02a2e6ca79b33f6e915e98f5a8cc5237fdb'; // UI: -$294.61
const WALLET_5 = '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2'; // UI: +$146.90
const WALLET_6 = '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d'; // UI: +$470.40 (was GOOD)

const UI_PNL: Record<string, number> = {
  [WHALE]: 22053934,
  [EGG]: 95976,
  [NEW]: -10021172,
  [WALLET_1]: -6138.90,
  [WALLET_2]: 4404.92,
  [WALLET_3]: 5.44,
  [WALLET_4]: -294.61,
  [WALLET_5]: 146.90,
  [WALLET_6]: 470.40,
};

interface Event {
  condition_id: string;
  outcome_index: number;
  event_type: string;
  qty: number;
  px: number;
  ts: string;
}

interface Position {
  amount: number;         // Can be negative for shorts
  avgPrice: number;       // WAC for longs, avg sell price for shorts
  realizedPnl: number;
  totalSellProceeds: number;  // Track cash received from sells (for shorts)
  totalSellQty: number;       // Track tokens sold (for shorts)
}

async function calculateWalletPnL(wallet: string, label: string) {
  console.log('\n' + '='.repeat(80));
  console.log(`${label}: ${wallet.slice(0, 10)}...`);
  console.log('='.repeat(80));

  // Step 1: Get unified event stream (CLOB trades + Redemptions)
  const eventsQuery = await clickhouse.query({
    query: `
      -- CLOB trades (deduplicated)
      SELECT
        condition_id,
        outcome_index,
        event_type,
        qty,
        px,
        ts
      FROM (
        SELECT
          m.condition_id AS condition_id,
          m.outcome_index AS outcome_index,
          if(t.side = 'buy', 'BUY', 'SELL') AS event_type,
          t.token_amount / 1000000.0 AS qty,
          if(t.token_amount > 0, t.usdc_amount / t.token_amount, 0) AS px,
          t.trade_time AS ts
        FROM (
          SELECT
            event_id,
            any(side) AS side,
            any(token_id) AS token_id,
            any(usdc_amount) AS usdc_amount,
            any(token_amount) AS token_amount,
            any(trade_time) AS trade_time
          FROM pm_trader_events_v2
          WHERE trader_wallet = '${wallet}' AND is_deleted = 0
          GROUP BY event_id
        ) t
        LEFT JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
        WHERE m.condition_id IS NOT NULL AND m.condition_id != ''
      )

      UNION ALL

      -- Redemptions as sells at payout price
      SELECT
        c.condition_id AS condition_id,
        -- Determine outcome_index from which payout is non-zero
        toUInt8(if(
          toInt32OrZero(arrayElement(splitByChar(',', replaceAll(replaceAll(r.payout_numerators, '[', ''), ']', '')), 1)) > 0,
          0,
          1
        )) AS outcome_index,
        'REDEEM' AS event_type,
        toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS qty,
        1.0 AS px,
        c.event_timestamp AS ts
      FROM pm_ctf_events c
      JOIN pm_condition_resolutions r ON c.condition_id = r.condition_id AND r.is_deleted = 0
      WHERE c.user_address = '${wallet}'
        AND c.event_type = 'PayoutRedemption'
        AND c.is_deleted = 0

      ORDER BY ts ASC
    `,
    format: 'JSONEachRow'
  });

  const events: Event[] = await eventsQuery.json() as Event[];
  console.log(`Total events: ${events.length.toLocaleString()}`);

  // Step 2: Run state machine
  const positions = new Map<string, Position>();

  let totalBuys = 0;
  let totalSells = 0;
  let totalRedeems = 0;

  for (const e of events) {
    const key = `${e.condition_id}:${e.outcome_index}`;

    let pos = positions.get(key);
    if (pos === undefined) {
      pos = { amount: 0, avgPrice: 0, realizedPnl: 0, totalSellProceeds: 0, totalSellQty: 0 };
      positions.set(key, pos);
    }

    if (e.event_type === 'BUY') {
      totalBuys++;

      // If we have a short position, buying closes it
      if (pos.amount < 0) {
        const shortClosed = Math.min(e.qty, -pos.amount);
        // Short PnL = (avg_sell_price - buy_price) * qty_closed
        const avgSellPrice = pos.totalSellQty > 0 ? pos.totalSellProceeds / pos.totalSellQty : 0;
        const shortPnl = shortClosed * (avgSellPrice - e.px);
        pos.realizedPnl += shortPnl;
        pos.amount += shortClosed;
        // Remaining qty goes to long position
        const longQty = e.qty - shortClosed;
        if (longQty > 0) {
          pos.avgPrice = e.px; // First long buy after short
          pos.amount += longQty;
        }
      } else {
        // Normal long: Update WAC
        const newAmount = pos.amount + e.qty;
        if (newAmount > 0) {
          pos.avgPrice = (pos.avgPrice * pos.amount + e.px * e.qty) / newAmount;
        }
        pos.amount = newAmount;
      }

    } else if (e.event_type === 'SELL' || e.event_type === 'REDEEM') {
      if (e.event_type === 'SELL') totalSells++;
      else totalRedeems++;

      // Track all sells for short position avg price calculation
      pos.totalSellProceeds += e.px * e.qty;
      pos.totalSellQty += e.qty;

      // Realize PnL on closing long positions
      if (pos.amount > 0) {
        const effectiveAmount = Math.min(e.qty, pos.amount);
        const deltaPnl = effectiveAmount * (e.px - pos.avgPrice);
        pos.realizedPnl += deltaPnl;
      }

      pos.amount -= e.qty; // Can go negative (short)
      // avgPrice does NOT change on sells
    }
  }

  console.log(`Processed: ${totalBuys} buys, ${totalSells} sells, ${totalRedeems} redemptions`);

  // Step 3: Get resolutions for mark-to-market
  const resolutionsQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        payout_numerators,
        payout_denominator
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
        AND payout_denominator != ''
        AND payout_denominator != '0'
    `,
    format: 'JSONEachRow'
  });

  const resolutions = new Map<string, {num: number[], denom: number}>();
  for (const r of await resolutionsQuery.json() as any[]) {
    const nums = r.payout_numerators.replace('[', '').replace(']', '').split(',').map((x: string) => parseInt(x) || 0);
    resolutions.set(r.condition_id, { num: nums, denom: parseInt(r.payout_denominator) || 1 });
  }

  // Step 4: Calculate REALIZED PnL only
  // Per GPT guidance: unrealized positions contribute zero to PnL
  // This gives a consistent, cash-based metric across all wallets
  let totalRealizedPnl = 0;
  let openPositions = 0;
  let resolvedUnredeemed = 0;
  let unresolved = 0;
  let totalOpenTokens = 0;

  for (const [key, pos] of positions) {
    // Sum up all realized PnL from the state machine
    totalRealizedPnl += pos.realizedPnl;

    // Track open positions for diagnostics only (not added to PnL)
    if (Math.abs(pos.amount) > 0.01) {
      openPositions++;
      totalOpenTokens += Math.abs(pos.amount);

      const [condId] = key.split(':');
      const res = resolutions.get(condId);

      if (res) {
        resolvedUnredeemed++; // Has holdings in a resolved market (not yet redeemed)
      } else {
        unresolved++; // Has holdings in an unresolved market
      }
    }
  }

  // REALIZED ONLY - no unrealized term
  const totalPnl = totalRealizedPnl;
  const uiPnl = UI_PNL[wallet] ?? 0;
  const diff = uiPnl === 0 ? 0 : ((totalPnl - uiPnl) / Math.abs(uiPnl) * 100);

  console.log(`\nOpen positions: ${openPositions} (${totalOpenTokens.toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens)`);
  console.log(`  Resolved but unredeemed: ${resolvedUnredeemed}`);
  console.log(`  Unresolved (open exposure): ${unresolved}`);

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`REALIZED PnL:   $${totalRealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  console.log(`(Open positions not counted - strict cash-based metric)`);

  return { label, totalPnl, uiPnl, diff };
}

async function main() {
  console.log('\n🔧 REALIZED-ONLY PnL Calculator (WAC State Machine v2)');
  console.log('Strict cash-based metric - open positions contribute ZERO');
  console.log('─'.repeat(60));
  console.log('Rules:');
  console.log('  • Redemptions = SELLS at payout price ($1 for winners)');
  console.log('  • avgPrice updated only on BUYs');
  console.log('  • realized_pnl = effective_amount × (sell_price - avg_price)');
  console.log('  • Unresolved/unredeemed positions = $0 (open exposure)');

  try {
    const results = [];

    // Original 3 whales
    results.push(await calculateWalletPnL(WHALE, 'WHALE'));
    results.push(await calculateWalletPnL(EGG, 'EGG'));
    results.push(await calculateWalletPnL(NEW, 'NEW'));

    // Additional 6 test wallets from previous session
    results.push(await calculateWalletPnL(WALLET_1, 'W1-9d36c'));
    results.push(await calculateWalletPnL(WALLET_2, 'W2-dfe10'));
    results.push(await calculateWalletPnL(WALLET_3, 'W3-418db'));
    results.push(await calculateWalletPnL(WALLET_4, 'W4-4974d'));
    results.push(await calculateWalletPnL(WALLET_5, 'W5-eab03'));
    results.push(await calculateWalletPnL(WALLET_6, 'W6-7dca4'));

    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY - REALIZED-ONLY PnL (ALL 9 WALLETS)');
    console.log('='.repeat(80));
    console.log('Wallet       Realized PnL         (UI PnL*)            Note');
    console.log('-'.repeat(80));

    results.forEach(r => {
      const note = r.totalPnl > 0 ? 'profit' : r.totalPnl < 0 ? 'loss' : 'neutral';
      console.log(`${r.label.padEnd(12)} $${r.totalPnl.toLocaleString(undefined, { maximumFractionDigits: 2 }).padStart(18)}  ($${r.uiPnl.toLocaleString().padStart(16)})  ${note}`);
    });

    console.log('-'.repeat(80));
    console.log('* UI PnL includes unrealized - our metric is strict cash-based');
    console.log('  Open positions (unresolved/unredeemed) = $0 until closed');

  } finally {
    await clickhouse.close();
  }
}

main().catch(console.error);
