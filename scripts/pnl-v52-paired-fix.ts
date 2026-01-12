/**
 * PnL Engine V52 - PAIRED TRADE FIX (Corrected)
 *
 * V51 bug: Zeroed out phantom positions but lost track of SHORT positions on winning outcomes.
 *
 * V52 fix: For paired trades, properly track:
 * - Net tokens on EACH outcome (not just phantom detection)
 * - Short losses = tokens you're SHORT on WINNING outcomes
 *
 * Key insight: In a paired trade (buy outcome 1, sell outcome 0):
 * - You end up LONG outcome 1, SHORT outcome 0
 * - If outcome 0 wins, you LOSE because you sold tokens worth $1
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const TEST_WALLETS = [
  '0x36a8b00a373f1d586fabaa6f17445a919189e507', // Ph=4, err=$53
  '0xfccaac5f10e7f3104eae2a648e0e943a0c9b5184', // Ph=4, err=$10
  '0xb7df7465a473195b622cdbf522e8643bf4874eeb', // Ph=2, err=$1089
  '0x600b4b5d639099c02c1c7de09bce59adf857e8fb', // From V50
  '0x44b0c095a54667270d144ee39c6f9a6fa6e9b703', // From V50
  '0x7a72b757a3ee6ea89e2a2e37fe4dce51baca21d3', // Ph=2, err=$16
  '0x24c0321e4a6e1b5ee9dc59e0ebff4e9f66eb9862', // From V50
  '0x85e24fc79f62d1d3ce7c161f25956e31a34dcfea', // From V50
  '0xc9d8bf0c236a8a389355623eefc17801feabb5b0', // From V50
  '0x0ef2e6592dcd1e109fe8e02e7a9243aa6d834039', // From V50
];

async function getApiPnL(wallet: string): Promise<number> {
  try {
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    if (res.ok) {
      const data = await res.json() as Array<{ t: number; p: number }>;
      if (data && data.length > 0) {
        return data[data.length - 1].p || 0;
      }
    }
  } catch {}
  return 0;
}

async function calculatePnLV52(wallet: string): Promise<{
  cashFlow: number;
  longWins: number;
  shortLosses: number;
  totalPnl: number;
  pairedTxCount: number;
  rawPhantom: number;
  tradeCount: number;
}> {
  // V52: Simple and correct approach
  // 1. Aggregate trades per (condition, outcome)
  // 2. Calculate net position = bought - sold (can be negative = SHORT)
  // 3. Cash flow = sell_usdc - buy_usdc
  // 4. Long wins = positive net_tokens on winning outcomes
  // 5. Short losses = negative net_tokens on winning outcomes (absolute value)
  //
  // The "phantom" concept is irrelevant for PnL - what matters is:
  // - How much cash did you receive/spend?
  // - What's your net token position per outcome?
  // - Did those positions win or lose?

  const query = `
    WITH
      -- Aggregate all trades per (condition, outcome)
      positions AS (
        SELECT
          m.condition_id,
          m.outcome_index,
          sumIf(t.token_amount / 1e6, t.side = 'buy') as bought,
          sumIf(t.token_amount / 1e6, t.side = 'sell') as sold,
          sumIf(t.usdc_amount / 1e6, t.side = 'sell') - sumIf(t.usdc_amount / 1e6, t.side = 'buy') as cash_flow
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${wallet}'
          AND m.condition_id != ''
        GROUP BY m.condition_id, m.outcome_index
      ),

      -- Add CTF splits/merges
      ctf_pos AS (
        SELECT condition_id, outcome_index,
          sum(shares_delta) as ctf_tokens,
          sum(cash_delta) as ctf_cash
        FROM pm_ctf_split_merge_expanded
        WHERE lower(wallet) = '${wallet}'
        GROUP BY condition_id, outcome_index
      ),

      -- Combine CLOB + CTF
      combined AS (
        SELECT
          COALESCE(p.condition_id, c.condition_id) as condition_id,
          COALESCE(p.outcome_index, c.outcome_index) as outcome_index,
          COALESCE(p.bought, 0) - COALESCE(p.sold, 0) + COALESCE(c.ctf_tokens, 0) as net_tokens,
          COALESCE(p.cash_flow, 0) + COALESCE(c.ctf_cash, 0) as cash_flow,
          COALESCE(p.sold, 0) as sold,
          COALESCE(p.bought, 0) as bought
        FROM positions p
        FULL OUTER JOIN ctf_pos c ON p.condition_id = c.condition_id AND p.outcome_index = c.outcome_index
      ),

      -- Join resolutions
      with_res AS (
        SELECT
          cb.*,
          r.payout_numerators,
          r.condition_id IS NULL OR r.payout_numerators = '' as is_open,
          toInt64OrNull(JSONExtractString(r.payout_numerators, cb.outcome_index + 1)) = 1 as won
        FROM combined cb
        LEFT JOIN pm_condition_resolutions r ON cb.condition_id = r.condition_id AND r.is_deleted = 0
      ),

      -- Aggregate results
      agg AS (
        SELECT
          sum(cash_flow) as total_cash,
          sumIf(net_tokens, net_tokens > 0 AND won = 1) as long_wins,
          sumIf(abs(net_tokens), net_tokens < 0 AND won = 1) as short_losses,
          countIf(sold > bought * 1.01) as raw_phantom
        FROM with_res
      ),

      -- Count paired transactions (for diagnostics)
      paired_count AS (
        SELECT count(DISTINCT transaction_hash) as cnt
        FROM (
          SELECT t.transaction_hash, m.condition_id,
            countIf(t.side = 'buy') as buys, countIf(t.side = 'sell') as sells,
            count(DISTINCT m.outcome_index) as outcomes
          FROM pm_trader_events_v3 t
          JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
          WHERE lower(t.trader_wallet) = '${wallet}' AND m.condition_id != ''
          GROUP BY t.transaction_hash, m.condition_id
          HAVING buys > 0 AND sells > 0 AND outcomes = 2
        )
      )

    SELECT
      round(total_cash, 2) as cash_flow,
      round(long_wins, 2) as long_wins,
      round(short_losses, 2) as short_losses,
      round(total_cash + long_wins - short_losses, 2) as total_pnl,
      (SELECT cnt FROM paired_count) as paired_tx_count,
      raw_phantom,
      (SELECT count() FROM pm_trader_events_v3 WHERE lower(trader_wallet) = '${wallet}') as trade_count
    FROM agg
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = (await result.json() as any[])[0] || {};

  return {
    cashFlow: Number(data.cash_flow) || 0,
    longWins: Number(data.long_wins) || 0,
    shortLosses: Number(data.short_losses) || 0,
    totalPnl: Number(data.total_pnl) || 0,
    pairedTxCount: Number(data.paired_tx_count) || 0,
    rawPhantom: Number(data.raw_phantom) || 0,
    tradeCount: Number(data.trade_count) || 0,
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log('PnL Engine V52 - CORRECTED FORMULA');
  console.log('='.repeat(80));
  console.log('');
  console.log('Formula: PnL = Cash_flow + Long_wins - Short_losses');
  console.log('');
  console.log('Key insight: "Phantom" positions are just SHORT positions.');
  console.log('If you sell tokens you never bought, you\'re SHORT that outcome.');
  console.log('If that outcome WINS, you LOSE (short_losses).');
  console.log('');

  const results: any[] = [];

  for (let i = 0; i < TEST_WALLETS.length; i++) {
    const wallet = TEST_WALLETS[i];
    console.log(`[${i + 1}/${TEST_WALLETS.length}] ${wallet.slice(0, 14)}...`);

    try {
      const pnl = await calculatePnLV52(wallet);
      const apiPnl = await getApiPnL(wallet);
      const error = pnl.totalPnl - apiPnl;
      const absError = Math.abs(error);

      let status: string;
      if (absError <= 10) {
        status = 'PASS';
      } else if (absError <= 100) {
        status = 'CLOSE';
      } else {
        status = 'FAIL';
      }

      console.log(`  Cash: $${pnl.cashFlow.toFixed(2)} | LongWins: $${pnl.longWins.toFixed(2)} | ShortLoss: $${pnl.shortLosses.toFixed(2)}`);
      console.log(`  Calc: $${pnl.totalPnl.toFixed(2)} | API: $${apiPnl.toFixed(2)} | Err: $${error.toFixed(2)} | ${status}`);
      console.log(`  (Trades: ${pnl.tradeCount}, Paired: ${pnl.pairedTxCount}, Raw phantom: ${pnl.rawPhantom})`);
      console.log('');

      results.push({
        wallet,
        cashFlow: pnl.cashFlow,
        longWins: pnl.longWins,
        shortLosses: pnl.shortLosses,
        calcPnl: pnl.totalPnl,
        apiPnl,
        error,
        absError,
        status,
        pairedTxCount: pnl.pairedTxCount,
        rawPhantom: pnl.rawPhantom,
        tradeCount: pnl.tradeCount,
      });
    } catch (err) {
      console.log(`  ERROR: ${err}`);
      console.log('');
    }

    await new Promise(r => setTimeout(r, 300));
  }

  // Summary
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const passed = results.filter(r => r.status === 'PASS').length;
  const close = results.filter(r => r.status === 'CLOSE').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  console.log(`\nResults:`);
  console.log(`  PASS (within $10): ${passed}/${results.length} (${(100 * passed / results.length).toFixed(1)}%)`);
  console.log(`  CLOSE (within $100): ${close}/${results.length}`);
  console.log(`  FAIL: ${failed}/${results.length}`);

  // Error distribution
  const errors = results.map(r => r.absError).sort((a, b) => a - b);
  console.log(`\nError distribution:`);
  console.log(`  Min: $${errors[0]?.toFixed(2)}`);
  console.log(`  Median: $${errors[Math.floor(errors.length / 2)]?.toFixed(2)}`);
  console.log(`  Max: $${errors[errors.length - 1]?.toFixed(2)}`);

  // Detailed results
  console.log(`\nDetailed results:`);
  console.log('-'.repeat(90));
  console.log('Wallet           | Cash      | LongWin   | ShortLoss | Calc      | API       | Err       | Status');
  console.log('-'.repeat(90));
  for (const r of results) {
    console.log(
      `${r.wallet.slice(0, 14)}... | ` +
      `${r.cashFlow.toFixed(2).padStart(9)} | ` +
      `${r.longWins.toFixed(2).padStart(9)} | ` +
      `${r.shortLosses.toFixed(2).padStart(9)} | ` +
      `${r.calcPnl.toFixed(2).padStart(9)} | ` +
      `${r.apiPnl.toFixed(2).padStart(9)} | ` +
      `${r.error.toFixed(2).padStart(9)} | ` +
      `${r.status}`
    );
  }

  // Save results
  const fs = await import('fs');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(`scripts/pilot-results-v52-${timestamp}.json`, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to scripts/pilot-results-v52-*.json`);
}

main().catch(console.error);
