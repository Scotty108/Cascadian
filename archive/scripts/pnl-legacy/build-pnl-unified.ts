/**
 * UNIFIED PnL Calculator
 *
 * The One Formula:
 *   PnL(t) = CF(t) + Σ q_p(t) × P_p(t)
 *
 * Where:
 *   CF(t) = cumulative cash flow (USDC received - USDC spent)
 *   q_p(t) = net token quantity per position (condition_id, outcome_index)
 *   P_p(t) = chosen price for tokens (varies by mode)
 *
 * Modes:
 *   1. REALIZED: P_p = 0 for all (pure cash flow)
 *   2. RESOLUTION: P_p = 1 for resolved winners, 0 otherwise
 *   3. MARK_TO_MARKET: P_p = payout for resolved, last_price for unresolved
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

type PricingMode = 'REALIZED' | 'RESOLUTION' | 'MARK_TO_MARKET';

interface Event {
  condition_id: string;
  outcome_index: number;
  event_type: 'BUY' | 'SELL' | 'SPLIT' | 'MERGE' | 'REDEEM';
  qty: number;        // token quantity
  price: number;      // price per token (for BUY/SELL)
  payout: number;     // payout per token (for REDEEM, typically 1)
  ts: string;
}

interface Position {
  qty: number;  // Can be negative (short)
}

interface Resolution {
  winning_outcome: number;  // 0 or 1
  payout_prices: number[];  // [price_outcome_0, price_outcome_1]
}

interface PnLResult {
  label: string;
  cashFlow: number;
  holdingsValue: number;
  totalPnL: number;
  uiPnl: number;
  diff: number;
  positionCount: number;
  unresolvedCount: number;
}

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

async function getResolutions(): Promise<Map<string, Resolution>> {
  const query = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        payout_numerators
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
        AND payout_denominator != ''
        AND payout_denominator != '0'
    `,
    format: 'JSONEachRow'
  });

  const resolutions = new Map<string, Resolution>();
  for (const r of await query.json() as any[]) {
    const nums = r.payout_numerators.replace('[', '').replace(']', '').split(',').map((x: string) => parseInt(x) || 0);
    const payout0 = nums[0] > 0 ? 1 : 0;
    const payout1 = (nums[1] || 0) > 0 ? 1 : 0;
    resolutions.set(r.condition_id, {
      winning_outcome: payout0 > 0 ? 0 : 1,
      payout_prices: [payout0, payout1]
    });
  }
  return resolutions;
}

async function getEvents(wallet: string): Promise<Event[]> {
  const query = await clickhouse.query({
    query: `
      -- CLOB BUY/SELL (deduplicated)
      SELECT
        m.condition_id AS condition_id,
        m.outcome_index AS outcome_index,
        if(t.side = 'buy', 'BUY', 'SELL') AS event_type,
        t.token_amount / 1000000.0 AS qty,
        if(t.token_amount > 0, t.usdc_amount / t.token_amount, 0) AS price,
        0 AS payout,
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

      UNION ALL

      -- CTF PositionSplit (mint) - creates BOTH outcomes at $1 each
      SELECT
        c.condition_id AS condition_id,
        outcome_idx AS outcome_index,
        'SPLIT' AS event_type,
        toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS qty,
        1.0 AS price,
        0 AS payout,
        c.event_timestamp AS ts
      FROM pm_ctf_events c
      ARRAY JOIN [0, 1] AS outcome_idx
      WHERE c.user_address = '${wallet}'
        AND c.event_type = 'PositionSplit'
        AND c.is_deleted = 0

      UNION ALL

      -- CTF PositionsMerge (burn) - destroys BOTH outcomes, returns $1
      SELECT
        c.condition_id AS condition_id,
        outcome_idx AS outcome_index,
        'MERGE' AS event_type,
        toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS qty,
        1.0 AS price,
        0 AS payout,
        c.event_timestamp AS ts
      FROM pm_ctf_events c
      ARRAY JOIN [0, 1] AS outcome_idx
      WHERE c.user_address = '${wallet}'
        AND c.event_type = 'PositionsMerge'
        AND c.is_deleted = 0

      UNION ALL

      -- CTF PayoutRedemption - give back winning tokens, receive payout
      SELECT
        c.condition_id AS condition_id,
        if(
          toInt32OrZero(arrayElement(splitByChar(',', replaceAll(replaceAll(r.payout_numerators, '[', ''), ']', '')), 1)) > 0,
          0, 1
        ) AS outcome_index,
        'REDEEM' AS event_type,
        toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS qty,
        0 AS price,
        1.0 AS payout,
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

  return await query.json() as Event[];
}

function calculatePnL(
  events: Event[],
  resolutions: Map<string, Resolution>,
  mode: PricingMode,
  label: string,
  uiPnl: number
): PnLResult {
  // State: CF and positions
  let CF = 0;
  const positions = new Map<string, Position>();

  // Process events
  for (const e of events) {
    const key = `${e.condition_id}:${e.outcome_index}`;

    // Get or create position
    let pos = positions.get(key);
    if (!pos) {
      pos = { qty: 0 };
      positions.set(key, pos);
    }

    switch (e.event_type) {
      case 'BUY':
        // Wallet pays price * qty in USDC
        CF -= e.price * e.qty;
        pos.qty += e.qty;
        break;

      case 'SELL':
        // Wallet receives price * qty in USDC
        CF += e.price * e.qty;
        pos.qty -= e.qty;
        break;

      case 'SPLIT':
        // Spend 1 USDC per token to mint (only count cash once per split, not twice)
        // Each split creates both outcomes, but costs 1 USDC total (not 2)
        // So we divide by 2 since we're counting each outcome separately
        CF -= 0.5 * e.qty;  // Half the cost per outcome
        pos.qty += e.qty;
        break;

      case 'MERGE':
        // Burn both outcomes, receive 1 USDC per set
        // Only count cash once per merge
        CF += 0.5 * e.qty;  // Half the return per outcome
        pos.qty -= e.qty;
        break;

      case 'REDEEM':
        // Give back winning tokens, receive payout * qty USDC
        CF += e.payout * e.qty;
        pos.qty -= e.qty;
        break;
    }
  }

  // Calculate holdings value based on mode
  let holdingsValue = 0;
  let positionCount = 0;
  let unresolvedCount = 0;

  for (const [key, pos] of positions) {
    if (Math.abs(pos.qty) < 0.01) continue;
    positionCount++;

    const [condId, outcomeIndexStr] = key.split(':');
    const outcomeIndex = parseInt(outcomeIndexStr);
    const res = resolutions.get(condId);

    let P = 0;  // Default price

    switch (mode) {
      case 'REALIZED':
        // P = 0 for everything
        P = 0;
        break;

      case 'RESOLUTION':
        if (res) {
          // Resolved: winner = $1, loser = $0
          P = res.payout_prices[outcomeIndex];
        } else {
          // Unresolved: P = 0
          P = 0;
          unresolvedCount++;
        }
        break;

      case 'MARK_TO_MARKET':
        if (res) {
          P = res.payout_prices[outcomeIndex];
        } else {
          // Would need last trade price here
          // For now, use 0.5 as conservative estimate
          P = 0.5;
          unresolvedCount++;
        }
        break;
    }

    holdingsValue += pos.qty * P;
  }

  const totalPnL = CF + holdingsValue;
  const diff = uiPnl === 0 ? 0 : ((totalPnL - uiPnl) / Math.abs(uiPnl) * 100);

  return {
    label,
    cashFlow: CF,
    holdingsValue,
    totalPnL,
    uiPnl,
    diff,
    positionCount,
    unresolvedCount
  };
}

function formatNum(n: number): string {
  if (Math.abs(n) >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

async function main() {
  const mode: PricingMode = (process.argv[2] as PricingMode) || 'RESOLUTION';

  console.log('\n🔧 UNIFIED PnL Calculator');
  console.log('═'.repeat(80));
  console.log('');
  console.log('The One Formula: PnL(t) = CF(t) + Σ q_p(t) × P_p(t)');
  console.log('');
  console.log(`Mode: ${mode}`);
  console.log(mode === 'REALIZED' ? '  → P_p = 0 for all (pure cash flow)' :
              mode === 'RESOLUTION' ? '  → P_p = $1 for resolved winners, $0 otherwise' :
              '  → P_p = payout for resolved, 0.5 for unresolved');
  console.log('');

  try {
    const resolutions = await getResolutions();
    console.log(`Loaded ${resolutions.size.toLocaleString()} resolutions`);

    const results: PnLResult[] = [];

    for (const w of WALLETS) {
      const events = await getEvents(w.address);
      const result = calculatePnL(events, resolutions, mode, w.label, w.uiPnl);
      results.push(result);

      console.log(`\n${result.label}: ${w.address.slice(0, 10)}...`);
      console.log(`  Events: ${events.length.toLocaleString()}`);
      console.log(`  CF(t):       ${formatNum(result.cashFlow)}`);
      console.log(`  Holdings:    ${formatNum(result.holdingsValue)} (${result.positionCount} positions, ${result.unresolvedCount} unresolved)`);
      console.log(`  PnL:         ${formatNum(result.totalPnL)} vs UI ${formatNum(result.uiPnl)} (${result.diff > 0 ? '+' : ''}${result.diff.toFixed(1)}%)`);
    }

    // Summary
    console.log('\n' + '═'.repeat(80));
    console.log(`SUMMARY - Mode: ${mode}`);
    console.log('═'.repeat(80));
    console.log('');
    console.log('Wallet    CF(t)          Holdings       PnL            UI             Diff');
    console.log('─'.repeat(80));

    let within5 = 0, within20 = 0;
    for (const r of results) {
      const match = Math.abs(r.diff) <= 5 ? '✓' : Math.abs(r.diff) <= 20 ? '~' : '✗';
      if (Math.abs(r.diff) <= 5) within5++;
      if (Math.abs(r.diff) <= 20) within20++;

      console.log(
        `${r.label.padEnd(9)} ` +
        `${formatNum(r.cashFlow).padStart(12)}  ` +
        `${formatNum(r.holdingsValue).padStart(12)}  ` +
        `${formatNum(r.totalPnL).padStart(12)}  ` +
        `${formatNum(r.uiPnl).padStart(12)}  ` +
        `${(r.diff > 0 ? '+' : '') + r.diff.toFixed(0) + '%'}  ${match}`
      );
    }

    console.log('─'.repeat(80));
    console.log(`Within 5%: ${within5}/9 | Within 20%: ${within20}/9`);
    console.log('');
    console.log('Usage: npx tsx build-pnl-unified.ts [REALIZED|RESOLUTION|MARK_TO_MARKET]');

  } finally {
    await clickhouse.close();
  }
}

main().catch(console.error);
