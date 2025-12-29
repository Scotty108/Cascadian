/**
 * PnL Calculator v5 - FINAL WORKING VERSION
 *
 * KEY INSIGHT: Redemptions reduce positions!
 *
 * When you redeem winning tokens:
 * 1. You give back N winning tokens
 * 2. You receive N USDC
 * 3. Your position is reduced by N
 *
 * Formula: PnL = (cash_out + redemptions + adjusted_holdings) - cash_in
 *
 * Where adjusted_holdings = sum((trade_position - redeemed) × payout_price)
 * for resolved markets only. Unresolved = $0.
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
  totalPnL: number;
  uiPnl: number;
  diff: number;
}

async function calculatePnL(wallet: string, label: string, uiPnl: number): Promise<PnLResult> {
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
        -- Redemptions with total cash received
        redemption_total AS (
          SELECT sum(toFloat64OrZero(amount_or_payout) / 1000000.0) AS redemptions
          FROM pm_ctf_events
          WHERE user_address = '${wallet}'
            AND event_type = 'PayoutRedemption'
            AND is_deleted = 0
        ),
        -- Redemptions by condition+outcome (for position adjustment)
        redemption_by_position AS (
          SELECT
            c.condition_id,
            if(
              toInt32OrZero(arrayElement(splitByChar(',', replaceAll(replaceAll(r.payout_numerators, '[', ''), ']', '')), 1)) > 0,
              0, 1
            ) AS winning_outcome,
            sum(toFloat64OrZero(c.amount_or_payout) / 1000000.0) AS redeemed_tokens
          FROM pm_ctf_events c
          JOIN pm_condition_resolutions r ON c.condition_id = r.condition_id AND r.is_deleted = 0
          WHERE c.user_address = '${wallet}'
            AND c.event_type = 'PayoutRedemption'
            AND c.is_deleted = 0
          GROUP BY c.condition_id, winning_outcome
        ),
        -- Trade positions
        trade_positions AS (
          SELECT
            m.condition_id,
            m.outcome_index,
            sum(if(t.side = 'buy', t.tokens, -t.tokens)) AS trade_net
          FROM trades t
          JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
          WHERE m.condition_id IS NOT NULL AND m.condition_id != ''
          GROUP BY m.condition_id, m.outcome_index
        ),
        -- Adjusted positions (trade - redeemed)
        adjusted_positions AS (
          SELECT
            tp.condition_id,
            tp.outcome_index,
            tp.trade_net - coalesce(rbp.redeemed_tokens, 0) AS actual_pos,
            r.payout_numerators
          FROM trade_positions tp
          LEFT JOIN redemption_by_position rbp
            ON tp.condition_id = rbp.condition_id AND tp.outcome_index = rbp.winning_outcome
          LEFT JOIN pm_condition_resolutions r
            ON tp.condition_id = r.condition_id AND r.is_deleted = 0
        ),
        -- Holdings value (only longs in winners, after redemption adjustment)
        holdings AS (
          SELECT
            -- Long positions in winning outcomes
            sumIf(
              actual_pos * if(
                outcome_index = 0,
                if(toInt32OrZero(arrayElement(splitByChar(',', replaceAll(replaceAll(payout_numerators, '[', ''), ']', '')), 1)) > 0, 1, 0),
                if(toInt32OrZero(arrayElement(splitByChar(',', replaceAll(replaceAll(payout_numerators, '[', ''), ']', '')), 2)) > 0, 1, 0)
              ),
              actual_pos > 0.01 AND payout_numerators IS NOT NULL
            )
            -- Plus short positions in winning outcomes (liability - will be negative)
            + sumIf(
              actual_pos * if(
                outcome_index = 0,
                if(toInt32OrZero(arrayElement(splitByChar(',', replaceAll(replaceAll(payout_numerators, '[', ''), ']', '')), 1)) > 0, 1, 0),
                if(toInt32OrZero(arrayElement(splitByChar(',', replaceAll(replaceAll(payout_numerators, '[', ''), ']', '')), 2)) > 0, 1, 0)
              ),
              actual_pos < -0.01 AND payout_numerators IS NOT NULL
            ) AS holdings_value
          FROM adjusted_positions
        )
      SELECT
        cf.cash_in,
        cf.cash_out,
        rt.redemptions,
        h.holdings_value
      FROM cash_flow cf, redemption_total rt, holdings h
    `,
    format: 'JSONEachRow'
  });

  const data = (await result.json())[0] as any;

  const cashIn = Number(data.cash_in || 0);
  const cashOut = Number(data.cash_out || 0);
  const redemptions = Number(data.redemptions || 0);
  const holdingsValue = Number(data.holdings_value || 0);

  const totalPnL = cashOut + redemptions + holdingsValue - cashIn;
  const diff = uiPnl === 0 ? 0 : ((totalPnL - uiPnl) / Math.abs(uiPnl) * 100);

  return {
    label,
    cashIn,
    cashOut,
    redemptions,
    holdingsValue,
    totalPnL,
    uiPnl,
    diff
  };
}

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1000000) {
    return `$${(n / 1000000).toFixed(2)}M`;
  } else if (Math.abs(n) >= 1000) {
    return `$${(n / 1000).toFixed(1)}K`;
  }
  return `$${n.toFixed(0)}`;
}

async function main() {
  console.log('\n🔧 PnL Calculator v5 - FINAL (with redemption fix)');
  console.log('═'.repeat(80));
  console.log('Formula: PnL = cash_out + redemptions + adjusted_holdings - cash_in');
  console.log('Key: Holdings are REDUCED by redemption amounts (redeemed tokens are gone)');
  console.log('');

  try {
    const results: PnLResult[] = [];

    for (const w of WALLETS) {
      const r = await calculatePnL(w.address, w.label, w.uiPnl);
      results.push(r);

      console.log(`\n${r.label}: ${w.address.slice(0, 10)}...`);
      console.log(`  Cash: in=${formatNumber(r.cashIn)}, out=${formatNumber(r.cashOut)}, redemptions=${formatNumber(r.redemptions)}`);
      console.log(`  Holdings (after redemption): ${formatNumber(r.holdingsValue)}`);
      console.log(`  PnL: ${formatNumber(r.totalPnL)} vs UI ${formatNumber(r.uiPnl)} (${r.diff > 0 ? '+' : ''}${r.diff.toFixed(1)}%)`);
    }

    console.log('\n' + '═'.repeat(80));
    console.log('SUMMARY');
    console.log('═'.repeat(80));
    console.log('');
    console.log('Wallet    Our PnL        UI PnL         Diff      Match');
    console.log('─'.repeat(60));

    let withinTarget = 0;
    for (const r of results) {
      const match = Math.abs(r.diff) <= 5 ? '✓ YES' : Math.abs(r.diff) <= 20 ? '~ CLOSE' : '✗ NO';
      if (Math.abs(r.diff) <= 5) withinTarget++;

      console.log(
        `${r.label.padEnd(9)} ` +
        `${formatNumber(r.totalPnL).padStart(12)}  ` +
        `${formatNumber(r.uiPnl).padStart(12)}  ` +
        `${(r.diff > 0 ? '+' : '') + r.diff.toFixed(1) + '%'.padStart(8)}  ${match}`
      );
    }

    console.log('─'.repeat(60));
    console.log(`Target ≤5%: ${withinTarget}/${results.length} wallets`);
    console.log('');

  } finally {
    await clickhouse.close();
  }
}

main().catch(console.error);
