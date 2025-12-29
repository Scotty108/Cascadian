/**
 * UI Activity PnL Simulator V2
 *
 * Implements a cost-basis realized PnL engine that includes:
 * 1. CLOB trades (buys and sells)
 * 2. PayoutRedemption events (burns treated as "sells at payout_price")
 *
 * Algorithm: Average Cost Basis
 * - Track position cost and qty per outcome
 * - On sell/redemption: realized_pnl = (sell_price - avg_cost) × qty_sold
 *
 * Usage: npx tsx scripts/pnl/ui-activity-pnl-simulator-v2.ts
 */

import { clickhouse } from '../../lib/clickhouse/client';

// UI benchmark values from Polymarket wallet pages (ALL timeframe)
const UI_BENCHMARK_WALLETS = [
  {
    wallet: '0x9d36c904930a7d06c5403f9e16996e919f586486',
    label: 'W1',
    profitLoss_all: -6138.90,
    volume_all: 205876.66,
    gain_all: 37312.46,
    loss_all: -43451.36,
  },
  {
    wallet: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838',
    label: 'W2',
    profitLoss_all: 4404.92,
    volume_all: 23191.46,
    gain_all: 6222.31,
    loss_all: -1817.39,
  },
  {
    wallet: '0x418db17eaa8f25eaf2085657d0becd82462c6786',
    label: 'W3',
    profitLoss_all: 5.44,
    volume_all: 30868.84,
    gain_all: 14.90,
    loss_all: -9.46,
  },
  {
    wallet: '0x4974d5c6c551e79c8f2f48f943e18d75c6a9ea15',
    label: 'W4',
    profitLoss_all: -294.61,
    volume_all: 141825.27,
    gain_all: 3032.88,
    loss_all: -3327.49,
  },
  {
    wallet: '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2',
    label: 'W5',
    profitLoss_all: 146.90,
    volume_all: 6721.77,
    gain_all: 148.40,
    loss_all: -1.50,
  },
  {
    wallet: '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d',
    label: 'W6',
    profitLoss_all: 470.40,
    volume_all: 44145.02,
    gain_all: 1485.80,
    loss_all: -1015.40,
  },
];

interface ActivityEvent {
  condition_id: string;
  outcome_index: number;
  event_time: string;
  event_type: 'CLOB_BUY' | 'CLOB_SELL' | 'REDEMPTION';
  qty_tokens: number;
  usdc_notional: number;
  price: number;
}

interface OutcomeState {
  position_qty: number;
  position_cost: number;
  realized_pnl: number;
}

interface WalletMetrics {
  pnl_activity_total: number;
  gain_activity: number;
  loss_activity: number;
  volume_traded: number;
  outcomes_traded: number;
  total_events: number;
  clob_events: number;
  redemption_events: number;
}

async function getClobFillsForWallet(wallet: string): Promise<ActivityEvent[]> {
  const query = `
    SELECT
      m.condition_id,
      m.outcome_index,
      fills.trade_time as event_time,
      fills.side,
      fills.qty_tokens,
      fills.usdc_notional,
      fills.price
    FROM (
      SELECT
        any(token_id) as token_id,
        any(trade_time) as trade_time,
        any(side) as side,
        any(token_amount) / 1000000.0 as qty_tokens,
        any(usdc_amount) / 1000000.0 as usdc_notional,
        CASE WHEN any(token_amount) > 0
          THEN any(usdc_amount) / any(token_amount)
          ELSE 0
        END as price
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
      GROUP BY event_id
    ) fills
    INNER JOIN pm_token_to_condition_map_v3 m ON fills.token_id = m.token_id_dec
    ORDER BY fills.trade_time ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  return rows.map(r => ({
    condition_id: r.condition_id,
    outcome_index: Number(r.outcome_index),
    event_time: r.event_time,
    event_type: r.side === 'buy' ? 'CLOB_BUY' : 'CLOB_SELL' as const,
    qty_tokens: Number(r.qty_tokens),
    usdc_notional: Number(r.usdc_notional),
    price: Number(r.price),
  }));
}

async function getRedemptionsForWallet(wallet: string): Promise<ActivityEvent[]> {
  // PayoutRedemption events - need to determine which outcome was redeemed
  // The payout = tokens_burned × payout_price (where payout_price = 1 for winner)
  // We need to join with resolutions to get payout_numerators
  const query = `
    SELECT
      e.condition_id,
      e.amount_or_payout,
      e.event_timestamp,
      r.payout_numerators
    FROM pm_ctf_events e
    LEFT JOIN pm_condition_resolutions r ON lower(e.condition_id) = lower(r.condition_id)
    WHERE lower(e.user_address) = lower('${wallet}')
      AND e.event_type = 'PayoutRedemption'
      AND e.is_deleted = 0
    ORDER BY e.event_timestamp ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  const events: ActivityEvent[] = [];

  for (const r of rows) {
    const payout_usdc = Number(r.amount_or_payout) / 1e6;
    const payout_numerators = r.payout_numerators ? JSON.parse(r.payout_numerators) : null;

    if (!payout_numerators || payout_usdc <= 0) continue;

    // Find the winning outcome (payout = 1)
    // For binary markets, one outcome has payout 1, the other 0
    // The redemption burns ALL held tokens, but only winners pay out
    for (let i = 0; i < payout_numerators.length; i++) {
      const payout_price = payout_numerators[i];
      if (payout_price > 0) {
        // This outcome paid out. The tokens burned = payout / payout_price
        const tokens_burned = payout_usdc / payout_price;

        events.push({
          condition_id: r.condition_id,
          outcome_index: i,
          event_time: r.event_timestamp,
          event_type: 'REDEMPTION',
          qty_tokens: tokens_burned,
          usdc_notional: payout_usdc,
          price: payout_price, // Redemption is "selling" at payout price ($1 for winner)
        });
      }
    }
  }

  return events;
}

function calculateActivityPnL(events: ActivityEvent[]): WalletMetrics {
  // Sort all events by time
  events.sort((a, b) => a.event_time.localeCompare(b.event_time));

  // State per outcome (condition_id + outcome_index)
  const outcomeStates = new Map<string, OutcomeState>();

  const getKey = (e: ActivityEvent): string =>
    `${e.condition_id}_${e.outcome_index}`;

  let volume_traded = 0;
  let clob_events = 0;
  let redemption_events = 0;

  // Process events in time order
  for (const event of events) {
    const key = getKey(event);

    if (!outcomeStates.has(key)) {
      outcomeStates.set(key, {
        position_qty: 0,
        position_cost: 0,
        realized_pnl: 0,
      });
    }

    const state = outcomeStates.get(key)!;

    if (event.event_type === 'CLOB_BUY') {
      clob_events++;
      volume_traded += event.usdc_notional;
      // Add to position at cost
      state.position_cost += event.usdc_notional;
      state.position_qty += event.qty_tokens;
    } else if (event.event_type === 'CLOB_SELL' || event.event_type === 'REDEMPTION') {
      if (event.event_type === 'CLOB_SELL') {
        clob_events++;
        volume_traded += event.usdc_notional;
      } else {
        redemption_events++;
        // Redemptions don't add to trading volume per se
      }

      if (state.position_qty > 0) {
        // Calculate average cost
        const avg_cost = state.position_cost / state.position_qty;
        const qty_to_sell = Math.min(event.qty_tokens, state.position_qty);

        // Realized PnL = (sell_price - avg_cost) × qty_sold
        const pnl_now = (event.price - avg_cost) * qty_to_sell;
        state.realized_pnl += pnl_now;

        // Reduce position
        state.position_cost -= avg_cost * qty_to_sell;
        state.position_qty -= qty_to_sell;
      }
      // If selling more than held, ignore the excess (no short selling)
    }
  }

  // Aggregate across all outcomes
  let pnl_activity_total = 0;
  let gain_activity = 0;
  let loss_activity = 0;

  for (const state of outcomeStates.values()) {
    pnl_activity_total += state.realized_pnl;
    if (state.realized_pnl > 0) {
      gain_activity += state.realized_pnl;
    } else {
      loss_activity += state.realized_pnl;
    }
  }

  return {
    pnl_activity_total,
    gain_activity,
    loss_activity,
    volume_traded,
    outcomes_traded: outcomeStates.size,
    total_events: events.length,
    clob_events,
    redemption_events,
  };
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDiff(computed: number, ui: number): string {
  const diff = computed - ui;
  const pct = ui !== 0 ? (Math.abs(diff / ui) * 100).toFixed(1) : 'N/A';
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${formatNumber(diff)} (${pct}%)`;
}

async function getV9EconPnL(wallet: string): Promise<number> {
  const query = `
    SELECT
      SUM(realized_pnl) as pnl_total
    FROM (
      SELECT
        net_cash + (net_tokens * payout_price) as realized_pnl
      FROM (
        SELECT
          n.net_cash,
          n.net_tokens,
          m.outcome_index,
          CASE WHEN r.resolved_at IS NOT NULL AND r.payout_numerators IS NOT NULL THEN
            arrayElement(JSONExtract(r.payout_numerators, 'Array(Float64)'), toUInt32(m.outcome_index + 1))
          ELSE 0 END as payout_price,
          r.resolved_at IS NOT NULL as is_resolved
        FROM (
          SELECT
            token_id,
            SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as net_tokens,
            SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as net_cash
          FROM (
            SELECT
              event_id,
              any(token_id) as token_id,
              any(side) as side,
              any(token_amount) / 1000000.0 as tokens,
              any(usdc_amount) / 1000000.0 as usdc
            FROM pm_trader_events_v2
            WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
            GROUP BY event_id
          )
          GROUP BY token_id
        ) n
        INNER JOIN pm_token_to_condition_map_v3 m ON n.token_id = m.token_id_dec
        LEFT JOIN pm_condition_resolutions r ON lower(m.condition_id) = lower(r.condition_id)
      )
      WHERE is_resolved = 1
    )
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = (await result.json())[0] as any;
  return Number(data?.pnl_total) || 0;
}

async function main() {
  console.log('='.repeat(100));
  console.log('UI ACTIVITY PNL SIMULATOR V2 - Cost Basis + Redemptions');
  console.log('='.repeat(100));
  console.log('');
  console.log('Algorithm: Average Cost Basis with PayoutRedemption events');
  console.log('  - CLOB buy: position_cost += usdc, position_qty += tokens');
  console.log('  - CLOB sell: realized_pnl += (sell_price - avg_cost) × qty_sold');
  console.log('  - Redemption: treated as sell at payout_price ($1 for winners)');
  console.log('');

  const results: Array<{
    ui: typeof UI_BENCHMARK_WALLETS[0];
    activity: WalletMetrics;
    v9_pnl: number;
  }> = [];

  for (const uiWallet of UI_BENCHMARK_WALLETS) {
    console.log(`Processing ${uiWallet.label} (${uiWallet.wallet.substring(0, 14)}...)...`);

    // Get CLOB fills and redemptions
    const clobFills = await getClobFillsForWallet(uiWallet.wallet);
    const redemptions = await getRedemptionsForWallet(uiWallet.wallet);
    const allEvents = [...clobFills, ...redemptions];

    const activity = calculateActivityPnL(allEvents);

    // Get V9 economic PnL for comparison
    const v9_pnl = await getV9EconPnL(uiWallet.wallet);

    results.push({ ui: uiWallet, activity, v9_pnl });
  }

  console.log('\n');

  // Detailed comparison for each wallet
  for (const { ui, activity, v9_pnl } of results) {
    console.log('='.repeat(80));
    console.log(`Wallet ${ui.label} (${ui.wallet.substring(0, 14)}...)`);
    console.log('='.repeat(80));
    console.log('');

    console.log('PROFIT/LOSS COMPARISON:');
    console.log(`  UI PnL:           $${formatNumber(ui.profitLoss_all)}`);
    console.log(`  Activity PnL:     $${formatNumber(activity.pnl_activity_total)}`);
    console.log(`  V9 Economic PnL:  $${formatNumber(v9_pnl)}`);
    console.log(`  Activity vs UI:   ${formatDiff(activity.pnl_activity_total, ui.profitLoss_all)}`);
    console.log(`  V9 vs UI:         ${formatDiff(v9_pnl, ui.profitLoss_all)}`);
    console.log('');

    console.log('GAIN/LOSS BREAKDOWN:');
    console.log(`  UI Gain:          $${formatNumber(ui.gain_all)}`);
    console.log(`  Activity Gain:    $${formatNumber(activity.gain_activity)}`);
    console.log(`  Diff:             ${formatDiff(activity.gain_activity, ui.gain_all)}`);
    console.log('');
    console.log(`  UI Loss:          $${formatNumber(ui.loss_all)}`);
    console.log(`  Activity Loss:    $${formatNumber(activity.loss_activity)}`);
    console.log(`  Diff:             ${formatDiff(activity.loss_activity, ui.loss_all)}`);
    console.log('');

    console.log('VOLUME:');
    console.log(`  UI Volume:        $${formatNumber(ui.volume_all)}`);
    console.log(`  Activity Volume:  $${formatNumber(activity.volume_traded)}`);
    console.log(`  Diff:             ${formatDiff(activity.volume_traded, ui.volume_all)}`);
    console.log('');

    console.log('EVENT STATS:');
    console.log(`  Outcomes traded:  ${activity.outcomes_traded}`);
    console.log(`  Total events:     ${activity.total_events}`);
    console.log(`  CLOB events:      ${activity.clob_events}`);
    console.log(`  Redemptions:      ${activity.redemption_events}`);
    console.log('');
  }

  // Summary tables
  console.log('\n');
  console.log('='.repeat(100));
  console.log('SUMMARY: PnL Comparison (Activity+Redemptions vs V9 vs UI)');
  console.log('='.repeat(100));
  console.log('');
  console.log('| Wallet | UI PnL | Activity PnL | V9 Econ PnL | Activity Match | V9 Match | Redemptions |');
  console.log('|--------|--------|--------------|-------------|----------------|----------|-------------|');

  for (const { ui, activity, v9_pnl } of results) {
    const activityPct = ui.profitLoss_all !== 0
      ? Math.abs((activity.pnl_activity_total - ui.profitLoss_all) / Math.abs(ui.profitLoss_all) * 100)
      : 0;
    const v9Pct = ui.profitLoss_all !== 0
      ? Math.abs((v9_pnl - ui.profitLoss_all) / Math.abs(ui.profitLoss_all) * 100)
      : 0;

    const activityMatch = activityPct < 5 ? 'YES' : activityPct < 20 ? 'PARTIAL' : 'NO';
    const v9Match = v9Pct < 5 ? 'YES' : v9Pct < 20 ? 'PARTIAL' : 'NO';

    console.log(`| ${ui.label.padEnd(6)} | ${formatNumber(ui.profitLoss_all).padStart(8)} | ${formatNumber(activity.pnl_activity_total).padStart(12)} | ${formatNumber(v9_pnl).padStart(11)} | ${(activityPct.toFixed(1) + '%').padStart(14)} | ${(v9Pct.toFixed(1) + '%').padStart(8)} | ${String(activity.redemption_events).padStart(11)} |`);
  }

  console.log('');
  console.log('='.repeat(100));
  console.log('SUMMARY: Volume Comparison');
  console.log('='.repeat(100));
  console.log('');
  console.log('| Wallet | UI Volume | Activity Volume | Diff % |');
  console.log('|--------|-----------|-----------------|--------|');

  for (const { ui, activity } of results) {
    const pct = ui.volume_all !== 0
      ? Math.abs((activity.volume_traded - ui.volume_all) / ui.volume_all * 100)
      : 0;

    console.log(`| ${ui.label.padEnd(6)} | ${formatNumber(ui.volume_all).padStart(12)} | ${formatNumber(activity.volume_traded).padStart(15)} | ${pct.toFixed(1).padStart(5)}% |`);
  }

  console.log('');
  console.log('Done!');
}

main().catch(console.error);
