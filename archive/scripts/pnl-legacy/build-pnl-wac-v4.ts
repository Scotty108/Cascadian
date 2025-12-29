/**
 * Build PnL using WAC State Machine (v4)
 *
 * FIXES:
 * 1. Resolution = Synthetic Sell (from v3)
 * 2. Include CTF PositionSplit as BUY at $1 (creates positions)
 * 3. Include CTF PositionMerge as SELL at $1 (closes positions)
 *
 * CTF Split/Merge are how many traders create/destroy outcome tokens.
 * Split: spend 1 USDC → get 1 YES + 1 NO token (cost basis = $1)
 * Merge: burn 1 YES + 1 NO → receive 1 USDC (sell price = $1)
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
const WHALE = '0x56687bf447db6ffa42ffe2204a05edaa20f55839';
const EGG = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const NEW = '0xf29bb8e0712075041e87e8605b69833ef738dd4c';

// Additional test wallets
const WALLET_1 = '0x9d36c904930a7d06c5403f9e16996e919f586486'; // UI: -$6,138.90
const WALLET_2 = '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838'; // UI: +$4,404.92
const WALLET_3 = '0x418db17eaa8f25eaf2085657d0becd82462c6786'; // UI: +$5.44
const WALLET_4 = '0x4974d02a2e6ca79b33f6e915e98f5a8cc5237fdb'; // UI: -$294.61
const WALLET_5 = '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2'; // UI: +$146.90
const WALLET_6 = '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d'; // UI: +$470.40

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
  source: string;
}

interface Position {
  amount: number;
  avgPrice: number;
  realizedPnl: number;
  totalSellProceeds: number;
  totalSellQty: number;
}

interface Resolution {
  condition_id: string;
  winning_outcome: number;
  payout_prices: number[];
}

async function calculateWalletPnL(wallet: string, label: string) {
  console.log('\n' + '='.repeat(80));
  console.log(`${label}: ${wallet.slice(0, 10)}...`);
  console.log('='.repeat(80));

  // Step 1: Get resolutions
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

  const resolutions = new Map<string, Resolution>();
  for (const r of await resolutionsQuery.json() as any[]) {
    const nums = r.payout_numerators.replace('[', '').replace(']', '').split(',').map((x: string) => parseInt(x) || 0);
    const payout0 = nums[0] > 0 ? 1 : 0;
    const payout1 = (nums[1] || 0) > 0 ? 1 : 0;
    const winningOutcome = payout0 > 0 ? 0 : (payout1 > 0 ? 1 : -1);

    resolutions.set(r.condition_id, {
      condition_id: r.condition_id,
      winning_outcome: winningOutcome,
      payout_prices: [payout0, payout1]
    });
  }

  // Step 2: Get unified event stream (CLOB + CTF Split/Merge)
  const eventsQuery = await clickhouse.query({
    query: `
      -- CLOB trades (deduplicated)
      SELECT
        condition_id,
        outcome_index,
        event_type,
        qty,
        px,
        ts,
        'CLOB' AS source
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

      -- CTF PositionSplit = BUY both outcomes at $1 each
      -- For each split, we get BOTH outcomes, so we expand to 2 rows
      SELECT
        c.condition_id AS condition_id,
        outcome_idx AS outcome_index,
        'BUY' AS event_type,
        toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS qty,
        1.0 AS px,  -- Split cost = $1 per outcome token
        c.event_timestamp AS ts,
        'CTF_SPLIT' AS source
      FROM pm_ctf_events c
      ARRAY JOIN [0, 1] AS outcome_idx
      WHERE c.user_address = '${wallet}'
        AND c.event_type = 'PositionSplit'
        AND c.is_deleted = 0

      UNION ALL

      -- CTF PositionMerge = SELL both outcomes at $1 each
      SELECT
        c.condition_id AS condition_id,
        outcome_idx AS outcome_index,
        'SELL' AS event_type,
        toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS qty,
        1.0 AS px,  -- Merge returns $1 per complete set
        c.event_timestamp AS ts,
        'CTF_MERGE' AS source
      FROM pm_ctf_events c
      ARRAY JOIN [0, 1] AS outcome_idx
      WHERE c.user_address = '${wallet}'
        AND c.event_type = 'PositionMerge'
        AND c.is_deleted = 0

      ORDER BY ts ASC
    `,
    format: 'JSONEachRow'
  });

  const events: Event[] = await eventsQuery.json() as Event[];

  // Count by source
  const sourceCounts: Record<string, number> = {};
  for (const e of events) {
    sourceCounts[e.source] = (sourceCounts[e.source] || 0) + 1;
  }
  console.log(`Events: ${Object.entries(sourceCounts).map(([k, v]) => `${k}=${v}`).join(', ')}`);

  // Step 3: Run state machine
  const positions = new Map<string, Position>();

  let totalBuys = 0;
  let totalSells = 0;

  for (const e of events) {
    const key = `${e.condition_id}:${e.outcome_index}`;

    let pos = positions.get(key);
    if (pos === undefined) {
      pos = { amount: 0, avgPrice: 0, realizedPnl: 0, totalSellProceeds: 0, totalSellQty: 0 };
      positions.set(key, pos);
    }

    if (e.event_type === 'BUY') {
      totalBuys++;

      if (pos.amount < 0) {
        const shortClosed = Math.min(e.qty, -pos.amount);
        const avgSellPrice = pos.totalSellQty > 0 ? pos.totalSellProceeds / pos.totalSellQty : 0;
        const shortPnl = shortClosed * (avgSellPrice - e.px);
        pos.realizedPnl += shortPnl;
        pos.amount += shortClosed;
        const longQty = e.qty - shortClosed;
        if (longQty > 0) {
          pos.avgPrice = e.px;
          pos.amount += longQty;
        }
      } else {
        const newAmount = pos.amount + e.qty;
        if (newAmount > 0) {
          pos.avgPrice = (pos.avgPrice * pos.amount + e.px * e.qty) / newAmount;
        }
        pos.amount = newAmount;
      }

    } else if (e.event_type === 'SELL') {
      totalSells++;

      pos.totalSellProceeds += e.px * e.qty;
      pos.totalSellQty += e.qty;

      if (pos.amount > 0) {
        const effectiveAmount = Math.min(e.qty, pos.amount);
        const deltaPnl = effectiveAmount * (e.px - pos.avgPrice);
        pos.realizedPnl += deltaPnl;
      }

      pos.amount -= e.qty;
    }
  }

  console.log(`State machine: ${totalBuys.toLocaleString()} buys, ${totalSells.toLocaleString()} sells`);

  // Step 4: Apply synthetic sells at resolution
  let tradingPnl = 0;
  let resolutionPnl = 0;
  let unresolvedHoldings = 0;
  let resolvedWinners = 0;
  let resolvedLosers = 0;
  let unresolvedCount = 0;

  for (const [key, pos] of positions) {
    tradingPnl += pos.realizedPnl;

    if (Math.abs(pos.amount) > 0.01) {
      const [condId, outcomeIndexStr] = key.split(':');
      const outcomeIndex = parseInt(outcomeIndexStr);
      const res = resolutions.get(condId);

      if (res) {
        const payoutPrice = res.payout_prices[outcomeIndex] ?? 0;

        if (pos.amount > 0) {
          const syntheticPnl = pos.amount * (payoutPrice - pos.avgPrice);
          resolutionPnl += syntheticPnl;

          if (payoutPrice > 0) {
            resolvedWinners++;
          } else {
            resolvedLosers++;
          }
        } else {
          const shortQty = -pos.amount;
          const avgSellPrice = pos.totalSellQty > 0 ? pos.totalSellProceeds / pos.totalSellQty : 0;
          const syntheticPnl = shortQty * (avgSellPrice - payoutPrice);
          resolutionPnl += syntheticPnl;
        }
      } else {
        unresolvedCount++;
        unresolvedHoldings += Math.abs(pos.amount) * pos.avgPrice;
      }
    }
  }

  const totalPnl = tradingPnl + resolutionPnl;
  const uiPnl = UI_PNL[wallet] ?? 0;
  const diff = uiPnl === 0 ? 0 : ((totalPnl - uiPnl) / Math.abs(uiPnl) * 100);

  console.log(`\nPositions: ${resolvedWinners} winners, ${resolvedLosers} losers, ${unresolvedCount} unresolved`);
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Trading PnL:     $${tradingPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  console.log(`Resolution PnL:  $${resolutionPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`TOTAL:           $${totalPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  console.log(`UI:              $${uiPnl.toLocaleString()}`);
  console.log(`Diff:            ${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`);

  return { label, totalPnl, uiPnl, diff, tradingPnl, resolutionPnl };
}

async function main() {
  console.log('\n🔧 PnL Calculator v4 - CLOB + CTF Split/Merge');
  console.log('─'.repeat(60));
  console.log('Sources: CLOB trades + CTF PositionSplit + CTF PositionMerge');
  console.log('Split = BUY both outcomes at $1, Merge = SELL both at $1');

  try {
    const results = [];

    results.push(await calculateWalletPnL(WHALE, 'WHALE'));
    results.push(await calculateWalletPnL(EGG, 'EGG'));
    results.push(await calculateWalletPnL(NEW, 'NEW'));
    results.push(await calculateWalletPnL(WALLET_1, 'W1-9d36c'));
    results.push(await calculateWalletPnL(WALLET_2, 'W2-dfe10'));
    results.push(await calculateWalletPnL(WALLET_3, 'W3-418db'));
    results.push(await calculateWalletPnL(WALLET_4, 'W4-4974d'));
    results.push(await calculateWalletPnL(WALLET_5, 'W5-eab03'));
    results.push(await calculateWalletPnL(WALLET_6, 'W6-7dca4'));

    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY - v4 (CLOB + CTF + Resolution Synthetic)');
    console.log('='.repeat(80));
    console.log('Wallet       Our PnL              UI PnL               Diff');
    console.log('-'.repeat(80));

    let withinTarget = 0;
    results.forEach(r => {
      const match = Math.abs(r.diff) <= 5 ? '✓' : Math.abs(r.diff) <= 20 ? '~' : '✗';
      if (Math.abs(r.diff) <= 5) withinTarget++;
      console.log(`${r.label.padEnd(12)} $${r.totalPnl.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(18)}  $${r.uiPnl.toLocaleString().padStart(18)}  ${r.diff > 0 ? '+' : ''}${r.diff.toFixed(1).padStart(6)}% ${match}`);
    });

    console.log('-'.repeat(80));
    console.log(`Target: ≤5% | Achieved: ${withinTarget}/${results.length}`);

  } finally {
    await clickhouse.close();
  }
}

main().catch(console.error);
