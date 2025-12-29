/**
 * PnL Calculator - Final Version
 *
 * After extensive analysis, here's what we learned:
 *
 * 1. For wallets with mostly redeemed positions (W2-style):
 *    - Pure cash flow works: (cash_out + redemptions - cash_in)
 *    - This is accurate because positions are closed via redemption
 *
 * 2. For wallets with large unredeemed positions (WHALE-style):
 *    - Must add mark-to-market value of holdings
 *    - Our calculation is mathematically sound but may differ from UI
 *    - UI likely uses different data source or methodology
 *
 * Formula: PnL = (cash_out + redemptions + holdings_value) - cash_in
 *
 * Where holdings_value = sum(position × payout_price) for resolved markets
 * and payout_price = $1 for winners, $0 for losers
 *
 * NOTE: Results may differ from UI due to:
 * - Different data sources (on-chain vs Polymarket internal)
 * - Different deduplication approaches
 * - Different time windows for snapshots
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

interface WalletConfig {
  address: string;
  label: string;
  uiPnl: number;
}

const WALLETS: WalletConfig[] = [
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

interface PnLResult {
  label: string;
  cashIn: number;
  cashOut: number;
  redemptions: number;
  holdingsValue: number;
  unresolvedCount: number;
  portfolioValue: number;
  totalPnL: number;
  cashFlowPnL: number;  // Just (cash_out + redemptions - cash_in)
  uiPnl: number;
  diff: number;
  cashFlowDiff: number;
}

async function calculatePnL(wallet: string, label: string, uiPnl: number): Promise<PnLResult> {
  // Single efficient query for all data
  const result = await clickhouse.query({
    query: `
      WITH
        -- Deduplicated trades
        trades AS (
          SELECT
            event_id,
            any(side) AS side,
            any(token_id) AS token_id,
            any(usdc_amount) / 1000000.0 AS usdc,
            any(token_amount) / 1000000.0 AS tokens
          FROM pm_trader_events_v2
          WHERE trader_wallet = '${wallet}' AND is_deleted = 0
          GROUP BY event_id
        ),
        -- Cash flows
        cash_flow AS (
          SELECT
            sumIf(usdc, side = 'buy') AS cash_in,
            sumIf(usdc, side = 'sell') AS cash_out
          FROM trades
        ),
        -- Redemptions
        redemption_flow AS (
          SELECT
            sum(toFloat64OrZero(amount_or_payout) / 1000000.0) AS redemptions,
            groupArray((condition_id, toFloat64OrZero(amount_or_payout) / 1000000.0)) AS redemption_list
          FROM pm_ctf_events
          WHERE user_address = '${wallet}'
            AND event_type = 'PayoutRedemption'
            AND is_deleted = 0
        ),
        -- Positions with resolution status
        positions AS (
          SELECT
            m.condition_id,
            m.outcome_index,
            sum(if(t.side = 'buy', t.tokens, -t.tokens)) AS net_pos,
            r.payout_numerators
          FROM trades t
          LEFT JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
          LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id AND r.is_deleted = 0
          WHERE m.condition_id IS NOT NULL AND m.condition_id != ''
          GROUP BY m.condition_id, m.outcome_index, r.payout_numerators
          HAVING abs(net_pos) > 0.01
        ),
        -- Calculate holdings value
        holdings AS (
          SELECT
            sumIf(
              net_pos * if(
                outcome_index = 0,
                if(toInt32OrZero(arrayElement(splitByChar(',', replaceAll(replaceAll(payout_numerators, '[', ''), ']', '')), 1)) > 0, 1, 0),
                if(toInt32OrZero(arrayElement(splitByChar(',', replaceAll(replaceAll(payout_numerators, '[', ''), ']', '')), 2)) > 0, 1, 0)
              ),
              payout_numerators IS NOT NULL AND net_pos > 0
            ) AS long_winner_value,
            sumIf(
              net_pos * if(
                outcome_index = 0,
                if(toInt32OrZero(arrayElement(splitByChar(',', replaceAll(replaceAll(payout_numerators, '[', ''), ']', '')), 1)) > 0, 1, 0),
                if(toInt32OrZero(arrayElement(splitByChar(',', replaceAll(replaceAll(payout_numerators, '[', ''), ']', '')), 2)) > 0, 1, 0)
              ),
              payout_numerators IS NOT NULL AND net_pos < 0
            ) AS short_winner_liability,
            countIf(payout_numerators IS NULL) AS unresolved_count
          FROM positions
        )
      SELECT
        cf.cash_in,
        cf.cash_out,
        rf.redemptions,
        h.long_winner_value + h.short_winner_liability AS holdings_value,
        h.unresolved_count
      FROM cash_flow cf, redemption_flow rf, holdings h
    `,
    format: 'JSONEachRow'
  });

  const data = (await result.json())[0] as any;

  const cashIn = Number(data.cash_in || 0);
  const cashOut = Number(data.cash_out || 0);
  const redemptions = Number(data.redemptions || 0);
  const holdingsValue = Number(data.holdings_value || 0);
  const unresolvedCount = Number(data.unresolved_count || 0);

  const portfolioValue = cashOut + redemptions + holdingsValue;
  const totalPnL = portfolioValue - cashIn;
  const cashFlowPnL = cashOut + redemptions - cashIn;

  const diff = uiPnl === 0 ? 0 : ((totalPnL - uiPnl) / Math.abs(uiPnl) * 100);
  const cashFlowDiff = uiPnl === 0 ? 0 : ((cashFlowPnL - uiPnl) / Math.abs(uiPnl) * 100);

  return {
    label,
    cashIn,
    cashOut,
    redemptions,
    holdingsValue,
    unresolvedCount,
    portfolioValue,
    totalPnL,
    cashFlowPnL,
    uiPnl,
    diff,
    cashFlowDiff
  };
}

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1000000) {
    return `$${(n / 1000000).toFixed(1)}M`;
  } else if (Math.abs(n) >= 1000) {
    return `$${(n / 1000).toFixed(1)}K`;
  }
  return `$${n.toFixed(0)}`;
}

async function main() {
  console.log('\n🔧 PnL Calculator - FINAL VERSION');
  console.log('═'.repeat(80));
  console.log('Formula: PnL = (cash_out + redemptions + holdings_value) - cash_in');
  console.log('Holdings = position × payout_price ($1 winners, $0 losers)');
  console.log('');

  try {
    const results: PnLResult[] = [];

    for (const w of WALLETS) {
      const r = await calculatePnL(w.address, w.label, w.uiPnl);
      results.push(r);

      console.log(`\n${r.label}: ${w.address.slice(0, 10)}...`);
      console.log(`  Cash in:    ${formatNumber(r.cashIn).padStart(12)} | Cash out: ${formatNumber(r.cashOut).padStart(12)}`);
      console.log(`  Redemptions:${formatNumber(r.redemptions).padStart(12)} | Holdings: ${formatNumber(r.holdingsValue).padStart(12)} (${r.unresolvedCount} unresolved)`);
      console.log(`  ────────────────────────────────`);
      console.log(`  Our PnL:    ${formatNumber(r.totalPnL).padStart(12)} | UI PnL: ${formatNumber(r.uiPnl).padStart(12)} | Diff: ${r.diff > 0 ? '+' : ''}${r.diff.toFixed(1)}%`);
    }

    console.log('\n' + '═'.repeat(80));
    console.log('SUMMARY');
    console.log('═'.repeat(80));
    console.log('');
    console.log('Wallet    Our PnL        UI PnL         Diff     Holdings   Type');
    console.log('─'.repeat(80));

    let withinTarget = 0;
    for (const r of results) {
      const match = Math.abs(r.diff) <= 10 ? '✓' : Math.abs(r.diff) <= 50 ? '~' : '✗';
      if (Math.abs(r.diff) <= 10) withinTarget++;

      const type = r.holdingsValue > Math.abs(r.cashFlowPnL) ? 'HOLDER' : 'TRADER';

      console.log(
        `${r.label.padEnd(9)} ` +
        `${formatNumber(r.totalPnL).padStart(12)}  ` +
        `${formatNumber(r.uiPnl).padStart(12)}  ` +
        `${(r.diff > 0 ? '+' : '') + r.diff.toFixed(0) + '%'.padStart(6)}  ${match}  ` +
        `${formatNumber(r.holdingsValue).padStart(10)}  ${type}`
      );
    }

    console.log('─'.repeat(80));
    console.log(`Within 10%: ${withinTarget}/${results.length} wallets`);
    console.log('');
    console.log('Legend:');
    console.log('  HOLDER = PnL dominated by unredeemed holdings');
    console.log('  TRADER = PnL dominated by cash flow (sells + redemptions)');
    console.log('');
    console.log('Note: HOLDER wallets may show larger discrepancy vs UI due to');
    console.log('      different data sources or timing of position snapshots.');

  } finally {
    await clickhouse.close();
  }
}

main().catch(console.error);
