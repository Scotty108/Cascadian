/**
 * Canonical PnL Engine
 *
 * Implements the correct PnL calculation from first principles:
 *
 * CANONICAL REALIZED PnL:
 *   = (CLOB Sells - CLOB Buys) - Splits + Merges + Redemptions
 *
 * UI_PNL_EST:
 *   = Realized Cash PnL + Unredeemed Winner Value - Unredeemed Short Liability
 *
 * Where:
 *   - Unredeemed Winner Value = Long positions on resolved winners - redeemed
 *   - Unredeemed Short Liability = Short positions on resolved winners - covered
 */

import { clickhouse } from '../../lib/clickhouse/client';

export interface CanonicalPnLResult {
  wallet: string;

  // Cash flows
  clob_buys: number;
  clob_sells: number;
  splits: number;
  merges: number;
  redemptions: number;

  // Realized PnL (pure cash basis)
  realized_cash_pnl: number;

  // Position breakdown (from CLOB net positions)
  gross_long_winners: number;
  gross_long_losers: number;
  gross_short_winners: number;
  gross_short_losers: number;

  // Redemptions applied to positions
  redeemed_from_long_winners: number;

  // Unredeemed position values
  unredeemed_long_winners: number;
  unredeemed_short_liability: number;

  // Final estimates
  ui_pnl_est: number;
}

export async function calculateCanonicalPnL(wallet: string): Promise<CanonicalPnLResult> {
  // Step 1: Get all CLOB trades (deduplicated by event_id)
  // event_id format: {tx_hash}_{order_id}-{m/t} - each is unique per trade
  const clobResult = await clickhouse.query({
    query: `
      SELECT
        sumIf(usdc, side = 'buy') as total_buy,
        sumIf(usdc, side = 'sell') as total_sell
      FROM (
        SELECT event_id, any(side) as side, any(usdc_amount) / 1e6 as usdc
        FROM pm_trader_events_v2
        WHERE trader_wallet = {wallet:String} AND is_deleted = 0
        GROUP BY event_id
      )
    `,
    query_params: { wallet },
    format: 'JSONEachRow',
  });
  const clob = ((await clobResult.json()) as any[])[0];

  // Step 2: Get CTF events (splits, merges, redemptions)
  const ctfResult = await clickhouse.query({
    query: `
      SELECT
        event_type,
        sum(toFloat64OrZero(amount_or_payout)) / 1e6 as total
      FROM pm_ctf_events
      WHERE user_address = {wallet:String} AND is_deleted = 0
      GROUP BY event_type
    `,
    query_params: { wallet },
    format: 'JSONEachRow',
  });
  const ctfRows = (await ctfResult.json()) as any[];
  const ctf: Record<string, number> = {};
  for (const row of ctfRows) {
    ctf[row.event_type] = row.total || 0;
  }

  const clob_buys = clob.total_buy || 0;
  const clob_sells = clob.total_sell || 0;
  const splits = ctf['PositionSplit'] || 0;
  const merges = ctf['PositionsMerge'] || 0;
  const redemptions = ctf['PayoutRedemption'] || 0;

  // Realized cash PnL = all cash received - all cash paid
  const realized_cash_pnl = clob_sells - clob_buys - splits + merges + redemptions;

  // Step 3: Get net CLOB positions per token with resolution status
  const posResult = await clickhouse.query({
    query: `
      SELECT
        token_id,
        net_tokens
      FROM (
        SELECT
          token_id,
          sum(if(side = 'buy', tokens, 0)) - sum(if(side = 'sell', tokens, 0)) as net_tokens
        FROM (
          SELECT event_id, any(token_id) as token_id, any(side) as side, any(token_amount) / 1e6 as tokens
          FROM pm_trader_events_v2
          WHERE trader_wallet = {wallet:String} AND is_deleted = 0
          GROUP BY event_id
        )
        GROUP BY token_id
      )
      WHERE abs(net_tokens) > 0.001
    `,
    query_params: { wallet },
    format: 'JSONEachRow',
  });
  const positions = (await posResult.json()) as any[];

  // Step 4: Classify positions by resolution status
  let gross_long_winners = 0;
  let gross_long_losers = 0;
  let gross_short_winners = 0;
  let gross_short_losers = 0;
  const winnerConditions = new Set<string>();

  for (const pos of positions) {
    // Get condition mapping
    const mapResult = await clickhouse.query({
      query: `
        SELECT condition_id, outcome_index
        FROM pm_token_to_condition_map_v3
        WHERE token_id_dec = {token_id:String}
        LIMIT 1
      `,
      query_params: { token_id: pos.token_id },
      format: 'JSONEachRow',
    });
    const map = (await mapResult.json()) as any[];
    if (map.length === 0) continue;

    const { condition_id, outcome_index } = map[0];

    // Get resolution
    const resResult = await clickhouse.query({
      query: `
        SELECT payout_numerators
        FROM pm_condition_resolutions
        WHERE condition_id = {condition_id:String}
        LIMIT 1
      `,
      query_params: { condition_id },
      format: 'JSONEachRow',
    });
    const res = (await resResult.json()) as any[];
    if (res.length === 0) continue; // Unresolved market

    let payout: number;
    try {
      const payoutArray = JSON.parse(res[0].payout_numerators);
      // Handle scaled payouts like [0, 1000000]
      const rawPayout = payoutArray[outcome_index];
      payout = rawPayout >= 1000 ? 1 : rawPayout; // Normalize to 0 or 1
    } catch {
      continue;
    }

    const netTokens = pos.net_tokens;

    if (netTokens > 0) {
      // Long position
      if (payout === 1) {
        gross_long_winners += netTokens;
        winnerConditions.add(condition_id);
      } else {
        gross_long_losers += netTokens;
      }
    } else {
      // Short position
      if (payout === 1) {
        gross_short_winners += Math.abs(netTokens);
        winnerConditions.add(condition_id);
      } else {
        gross_short_losers += Math.abs(netTokens);
      }
    }
  }

  // Step 5: Get redemptions that reduced our winner positions
  let redeemed_from_long_winners = 0;
  if (winnerConditions.size > 0) {
    const conditionList = Array.from(winnerConditions);
    const redemptionResult = await clickhouse.query({
      query: `
        SELECT sum(toFloat64OrZero(amount_or_payout)) / 1e6 as total_redeemed
        FROM pm_ctf_events
        WHERE user_address = {wallet:String}
          AND event_type = 'PayoutRedemption'
          AND is_deleted = 0
          AND condition_id IN {conditions:Array(String)}
      `,
      query_params: { wallet, conditions: conditionList },
      format: 'JSONEachRow',
    });
    const red = ((await redemptionResult.json()) as any[])[0];
    redeemed_from_long_winners = red?.total_redeemed || 0;
  }

  // Step 6: Calculate unredeemed values
  const unredeemed_long_winners = Math.max(0, gross_long_winners - redeemed_from_long_winners);
  const unredeemed_short_liability = gross_short_winners; // Shorts can't be "redeemed" - you owe them

  // UI PnL Estimate = Realized + Unredeemed Winners - Short Liability
  const ui_pnl_est = realized_cash_pnl + unredeemed_long_winners - unredeemed_short_liability;

  return {
    wallet,
    clob_buys,
    clob_sells,
    splits,
    merges,
    redemptions,
    realized_cash_pnl,
    gross_long_winners,
    gross_long_losers,
    gross_short_winners,
    gross_short_losers,
    redeemed_from_long_winners,
    unredeemed_long_winners,
    unredeemed_short_liability,
    ui_pnl_est,
  };
}

// Format helpers
export function formatUsd(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(1) + 'K';
  return sign + '$' + abs.toFixed(0);
}

// CLI runner
if (require.main === module) {
  const BENCHMARK_WALLETS = [
    { addr: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', label: 'W2 (Retail)', uiPnl: 4404.92 },
    { addr: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', label: 'W_22M (Operator)', uiPnl: 22053934 },
    { addr: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', label: 'W_97K (Mixed)', uiPnl: 96731 },
    { addr: '0xf29bb8e0712075041e87e8605b69833ef738dd4c', label: 'W_-10M (Operator)', uiPnl: -10021172 },
  ];

  async function main() {
    console.log('═'.repeat(100));
    console.log('CANONICAL PnL ENGINE - BENCHMARK TEST');
    console.log('═'.repeat(100));
    console.log('');
    console.log('Formula:');
    console.log('  Realized Cash PnL = (CLOB Sells - CLOB Buys) - Splits + Merges + Redemptions');
    console.log('  UI_PNL_EST = Realized Cash PnL + Unredeemed Long Winners - Unredeemed Short Liability');
    console.log('');

    const results: Array<{
      label: string;
      uiPnl: number;
      result: CanonicalPnLResult;
    }> = [];

    for (const w of BENCHMARK_WALLETS) {
      console.log(`Processing ${w.label}...`);
      const result = await calculateCanonicalPnL(w.addr);
      results.push({ label: w.label, uiPnl: w.uiPnl, result });
    }

    // Summary table
    console.log('\n' + '═'.repeat(100));
    console.log('RESULTS SUMMARY');
    console.log('═'.repeat(100));
    console.log('');
    console.log(
      'Wallet'.padEnd(20) +
        ' | ' +
        'UI PnL'.padStart(12) +
        ' | ' +
        'Estimate'.padStart(12) +
        ' | ' +
        'Difference'.padStart(12) +
        ' | ' +
        'Error %'.padStart(10)
    );
    console.log('─'.repeat(80));

    for (const { label, uiPnl, result } of results) {
      const diff = result.ui_pnl_est - uiPnl;
      const pct = (diff / Math.abs(uiPnl)) * 100;
      const sign = diff >= 0 ? '+' : '';

      console.log(
        label.padEnd(20) +
          ' | ' +
          formatUsd(uiPnl).padStart(12) +
          ' | ' +
          formatUsd(result.ui_pnl_est).padStart(12) +
          ' | ' +
          (sign + formatUsd(diff)).padStart(12) +
          ' | ' +
          (sign + pct.toFixed(1) + '%').padStart(10)
      );
    }

    // Detailed breakdown
    console.log('\n' + '═'.repeat(100));
    console.log('DETAILED BREAKDOWN');
    console.log('═'.repeat(100));

    for (const { label, uiPnl, result } of results) {
      console.log(`\n${label}:`);
      console.log('  CASH FLOWS:');
      console.log(`    CLOB Buys:           ${formatUsd(-result.clob_buys).padStart(15)}`);
      console.log(`    CLOB Sells:          ${formatUsd(result.clob_sells).padStart(15)}`);
      console.log(`    Splits:              ${formatUsd(-result.splits).padStart(15)}`);
      console.log(`    Merges:              ${formatUsd(result.merges).padStart(15)}`);
      console.log(`    Redemptions:         ${formatUsd(result.redemptions).padStart(15)}`);
      console.log(`    ──────────────────────────────────`);
      console.log(`    Realized Cash PnL:   ${formatUsd(result.realized_cash_pnl).padStart(15)}`);

      console.log('  POSITION VALUES:');
      console.log(`    Long Winners (gross):  ${formatUsd(result.gross_long_winners).padStart(15)}`);
      console.log(`    Long Losers (gross):   ${formatUsd(result.gross_long_losers).padStart(15)}`);
      console.log(`    Short Winners (gross): ${formatUsd(-result.gross_short_winners).padStart(15)} (liability)`);
      console.log(`    Short Losers (gross):  ${formatUsd(result.gross_short_losers).padStart(15)} (profit)`);

      console.log('  UNREDEEMED:');
      console.log(`    Redeemed from Winners: ${formatUsd(result.redeemed_from_long_winners).padStart(15)}`);
      console.log(`    Unredeemed Long Win:   ${formatUsd(result.unredeemed_long_winners).padStart(15)}`);
      console.log(`    Unredeemed Short Liab: ${formatUsd(-result.unredeemed_short_liability).padStart(15)}`);

      console.log('  FINAL:');
      console.log(`    UI_PNL_EST:            ${formatUsd(result.ui_pnl_est).padStart(15)}`);
      console.log(`    UI PnL (actual):       ${formatUsd(uiPnl).padStart(15)}`);
      console.log(`    Difference:            ${formatUsd(result.ui_pnl_est - uiPnl).padStart(15)}`);
    }

    console.log('\n' + '═'.repeat(100));
    console.log('ANALYSIS COMPLETE');
    console.log('═'.repeat(100));
  }

  main().catch(console.error);
}
