/**
 * Build Wallet Feature Table for UI PnL Estimation
 *
 * For each wallet, calculates:
 * 1. Trading cashflows (buys, sells)
 * 2. Redemption payouts (from CTF events)
 * 3. Resolved position values (unredeemed tokens on resolved markets)
 * 4. Net position breakdown (long vs short exposure)
 */

import { clickhouse } from '../../lib/clickhouse/client';

interface WalletInfo {
  addr: string;
  label: string;
  uiPnl: number;
}

const BENCHMARK_WALLETS: WalletInfo[] = [
  {
    addr: '0x56687bf447db6ffa42ffe2204a05edaa20f55839',
    label: 'W_22M',
    uiPnl: 22053934,
  },
  {
    addr: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
    label: 'W_97K',
    uiPnl: 96731,
  },
  {
    addr: '0xf29bb8e0712075041e87e8605b69833ef738dd4c',
    label: 'W_-10M',
    uiPnl: -10021172,
  },
  // Add W2 from our benchmark set
  {
    addr: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838',
    label: 'W2',
    uiPnl: 4405, // $4,404.92 from our benchmarks
  },
];

interface WalletFeatures {
  wallet: string;
  label: string;
  uiPnl: number;

  // Trading cashflows
  totalBuyUsdc: number;
  totalSellUsdc: number;
  netCashflow: number;

  // Token positions
  totalBuyTokens: number;
  totalSellTokens: number;
  netTokens: number;

  // Redemption payouts (actual CTF events)
  redemptionPayout: number;

  // Resolved position values (unredeemed)
  resolvedWinnerValue: number;
  resolvedLoserValue: number;
  resolvedUnknownValue: number;

  // Open position values
  openPositionValue: number;

  // Derived metrics
  tradingPnl: number; // sells - buys
  realizedPnl: number; // tradingPnl + redemptionPayout
  impliedResolvedPnl: number; // tradingPnl + resolvedWinnerValue (for unredeemed winners)
  totalEstimatedPnl: number;
}

async function buildWalletFeatures(wallet: string, label: string, uiPnl: number): Promise<WalletFeatures> {
  // 1. Trading cashflows from CLOB trades
  const tradingResult = await clickhouse.query({
    query: `
      SELECT
        sum(if(side = 'buy', usdc, 0)) as total_buy_usdc,
        sum(if(side = 'sell', usdc, 0)) as total_sell_usdc,
        sum(if(side = 'buy', tokens, 0)) as total_buy_tokens,
        sum(if(side = 'sell', tokens, 0)) as total_sell_tokens
      FROM (
        SELECT
          event_id,
          any(side) as side,
          any(usdc_amount) / 1e6 as usdc,
          any(token_amount) / 1e6 as tokens
        FROM pm_trader_events_v2
        WHERE trader_wallet = {wallet:String} AND is_deleted = 0
        GROUP BY event_id
      )
    `,
    query_params: { wallet },
    format: 'JSONEachRow',
  });
  const trading = (await tradingResult.json()) as Array<{
    total_buy_usdc: number;
    total_sell_usdc: number;
    total_buy_tokens: number;
    total_sell_tokens: number;
  }>;

  // 2. Redemption payouts from CTF events
  const redemptionResult = await clickhouse.query({
    query: `
      SELECT
        sum(toFloat64OrZero(amount_or_payout)) / 1e6 as total_payout
      FROM pm_ctf_events
      WHERE user_address = {wallet:String}
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
    `,
    query_params: { wallet },
    format: 'JSONEachRow',
  });
  const redemption = (await redemptionResult.json()) as Array<{ total_payout: number }>;

  // 3. Net position breakdown per token with resolution status
  const positionsResult = await clickhouse.query({
    query: `
      WITH positions AS (
        SELECT
          token_id,
          sum(if(side = 'buy', tokens, 0)) as bought,
          sum(if(side = 'sell', tokens, 0)) as sold,
          sum(if(side = 'buy', tokens, 0)) - sum(if(side = 'sell', tokens, 0)) as net_tokens
        FROM (
          SELECT
            event_id,
            any(token_id) as token_id,
            any(side) as side,
            any(token_amount) / 1e6 as tokens
          FROM pm_trader_events_v2
          WHERE trader_wallet = {wallet:String} AND is_deleted = 0
          GROUP BY event_id
        )
        GROUP BY token_id
      ),
      with_resolution AS (
        SELECT
          p.token_id,
          p.net_tokens,
          m.condition_id,
          m.outcome_index,
          r.payout_numerators,
          r.resolved_at
        FROM positions p
        LEFT JOIN pm_token_to_condition_map_v3 m ON p.token_id = m.token_id_dec
        LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      )
      SELECT
        -- Resolved winners (payout = 1)
        sum(
          if(
            payout_numerators IS NOT NULL AND net_tokens > 0,
            multiIf(
              -- Parse payout_numerators string and check outcome_index
              JSONExtractInt(payout_numerators, outcome_index + 1) = 1, net_tokens,
              JSONExtractInt(payout_numerators, outcome_index + 1) = 1000000, net_tokens,
              JSONExtractInt(payout_numerators, outcome_index + 1) = 1000000000000000000, net_tokens,
              0
            ),
            0
          )
        ) as resolved_winner_tokens,
        -- Resolved losers (payout = 0)
        sum(
          if(
            payout_numerators IS NOT NULL AND net_tokens > 0,
            multiIf(
              JSONExtractInt(payout_numerators, outcome_index + 1) = 0, net_tokens,
              0
            ),
            0
          )
        ) as resolved_loser_tokens,
        -- Open positions (no resolution yet)
        sum(if(payout_numerators IS NULL AND net_tokens > 0, net_tokens, 0)) as open_tokens,
        -- Negative positions (shorts)
        sum(if(net_tokens < 0, abs(net_tokens), 0)) as short_tokens
      FROM with_resolution
    `,
    query_params: { wallet },
    format: 'JSONEachRow',
  });
  const positions = (await positionsResult.json()) as Array<{
    resolved_winner_tokens: number;
    resolved_loser_tokens: number;
    open_tokens: number;
    short_tokens: number;
  }>;

  const totalBuyUsdc = trading[0].total_buy_usdc || 0;
  const totalSellUsdc = trading[0].total_sell_usdc || 0;
  const totalBuyTokens = trading[0].total_buy_tokens || 0;
  const totalSellTokens = trading[0].total_sell_tokens || 0;
  const redemptionPayout = redemption[0].total_payout || 0;
  const resolvedWinnerValue = positions[0].resolved_winner_tokens || 0;
  const resolvedLoserValue = positions[0].resolved_loser_tokens || 0;
  const openPositionValue = (positions[0].open_tokens || 0) * 0.5; // Estimate at 50%

  const netCashflow = totalSellUsdc - totalBuyUsdc;
  const netTokens = totalBuyTokens - totalSellTokens;
  const tradingPnl = netCashflow;
  const realizedPnl = tradingPnl + redemptionPayout;
  const impliedResolvedPnl = tradingPnl + resolvedWinnerValue;
  const totalEstimatedPnl = tradingPnl + resolvedWinnerValue + openPositionValue;

  return {
    wallet,
    label,
    uiPnl,
    totalBuyUsdc,
    totalSellUsdc,
    netCashflow,
    totalBuyTokens,
    totalSellTokens,
    netTokens,
    redemptionPayout,
    resolvedWinnerValue,
    resolvedLoserValue,
    resolvedUnknownValue: 0,
    openPositionValue,
    tradingPnl,
    realizedPnl,
    impliedResolvedPnl,
    totalEstimatedPnl,
  };
}

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000) {
    return `$${(n / 1_000_000).toFixed(2)}M`;
  } else if (Math.abs(n) >= 1000) {
    return `$${(n / 1000).toFixed(1)}K`;
  } else {
    return `$${n.toFixed(0)}`;
  }
}

async function main(): Promise<void> {
  console.log('═'.repeat(100));
  console.log('WALLET FEATURE TABLE FOR UI PNL ESTIMATION');
  console.log('═'.repeat(100));

  const features: WalletFeatures[] = [];

  for (const w of BENCHMARK_WALLETS) {
    console.log(`\nProcessing ${w.label}...`);
    const f = await buildWalletFeatures(w.addr, w.label, w.uiPnl);
    features.push(f);
  }

  // Print feature table
  console.log('\n' + '═'.repeat(100));
  console.log('FEATURE TABLE');
  console.log('═'.repeat(100));

  console.log(`
${'Wallet'.padEnd(10)} | ${'UI PnL'.padStart(12)} | ${'Buys'.padStart(12)} | ${'Sells'.padStart(12)} | ${'Trading PnL'.padStart(12)} | ${'Redemption'.padStart(12)} | ${'Winner Val'.padStart(12)} | ${'Open Val'.padStart(10)}
${'-'.repeat(100)}`);

  for (const f of features) {
    console.log(
      `${f.label.padEnd(10)} | ` +
        `${formatNumber(f.uiPnl).padStart(12)} | ` +
        `${formatNumber(f.totalBuyUsdc).padStart(12)} | ` +
        `${formatNumber(f.totalSellUsdc).padStart(12)} | ` +
        `${formatNumber(f.tradingPnl).padStart(12)} | ` +
        `${formatNumber(f.redemptionPayout).padStart(12)} | ` +
        `${formatNumber(f.resolvedWinnerValue).padStart(12)} | ` +
        `${formatNumber(f.openPositionValue).padStart(10)}`
    );
  }

  // Test different PnL formulas
  console.log('\n' + '═'.repeat(100));
  console.log('PNL FORMULA CANDIDATES');
  console.log('═'.repeat(100));

  console.log(`
${'Wallet'.padEnd(10)} | ${'UI PnL'.padStart(12)} | ${'F1: Trade'.padStart(12)} | ${'F2: +Redemp'.padStart(12)} | ${'F3: +Winners'.padStart(12)} | ${'F4: +Open'.padStart(12)} | ${'Best Match'.padStart(12)}
${'-'.repeat(100)}`);

  for (const f of features) {
    const formulas = [
      { name: 'F1', value: f.tradingPnl },
      { name: 'F2', value: f.realizedPnl },
      { name: 'F3', value: f.impliedResolvedPnl },
      { name: 'F4', value: f.totalEstimatedPnl },
    ];

    // Find best match
    let bestMatch = formulas[0];
    let bestDiff = Math.abs(f.uiPnl - formulas[0].value);
    for (const formula of formulas) {
      const diff = Math.abs(f.uiPnl - formula.value);
      if (diff < bestDiff) {
        bestMatch = formula;
        bestDiff = diff;
      }
    }

    console.log(
      `${f.label.padEnd(10)} | ` +
        `${formatNumber(f.uiPnl).padStart(12)} | ` +
        `${formatNumber(formulas[0].value).padStart(12)} | ` +
        `${formatNumber(formulas[1].value).padStart(12)} | ` +
        `${formatNumber(formulas[2].value).padStart(12)} | ` +
        `${formatNumber(formulas[3].value).padStart(12)} | ` +
        `${bestMatch.name.padStart(12)}`
    );
  }

  // Show detailed error analysis
  console.log('\n' + '═'.repeat(100));
  console.log('ERROR ANALYSIS (UI PnL - Formula)');
  console.log('═'.repeat(100));

  for (const f of features) {
    console.log(`\n${f.label}:`);
    console.log(`  UI PnL:              ${formatNumber(f.uiPnl)}`);
    console.log(`  F3 (Trade+Winners):  ${formatNumber(f.impliedResolvedPnl)}`);
    console.log(`  Difference:          ${formatNumber(f.uiPnl - f.impliedResolvedPnl)}`);
    console.log(`  Error %:             ${(((f.uiPnl - f.impliedResolvedPnl) / Math.abs(f.uiPnl)) * 100).toFixed(1)}%`);
    console.log(`  Components:`);
    console.log(`    - Net Cashflow:    ${formatNumber(f.netCashflow)}`);
    console.log(`    - Winner Value:    ${formatNumber(f.resolvedWinnerValue)}`);
    console.log(`    - Loser Value:     ${formatNumber(f.resolvedLoserValue)} (should be 0)`);
    console.log(`    - Open Value:      ${formatNumber(f.openPositionValue)}`);
    console.log(`    - Redemption:      ${formatNumber(f.redemptionPayout)}`);
  }

  console.log('\n' + '═'.repeat(100));
  console.log('ANALYSIS COMPLETE');
  console.log('═'.repeat(100));
}

main().catch(console.error);
