/**
 * PnL Engine V53 - CTF CASH DOUBLE-COUNT FIX
 *
 * V52 bug: CTF expanded table has cash_delta on BOTH outcomes for merges
 *          But a merge only gives $1 per PAIR (total), not per outcome
 *
 * V53 fix: Only count CTF cash_delta for outcome_index = 0
 *          (Tokens still tracked per outcome, but cash only once)
 *
 * Formula: PnL = Cash_flow + Long_wins - Short_losses
 *   where Cash_flow = CLOB_cash + CTF_cash (corrected)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

// Broader test set - original 3 + 10 random active wallets
const TEST_WALLETS = [
  // Original 3 with known issues
  '0x36a8b00a373f1d586fabaa6f17445a919189e507', // Ph=4, was err=$53
  '0xfccaac5f10e7f3104eae2a648e0e943a0c9b5184', // Ph=4, was err=$10
  '0xb7df7465a473195b622cdbf522e8643bf4874eeb', // CTF heavy, fixed to err=$11
  // 10 random active wallets (50-200 trades in last 30 days)
  '0x68c0e30cba61df72f567177491dad3943c592efa',
  '0x6b5db9dee9e59ace85013282f74664c503b36d74',
  '0xbde28d6ec74ac86ae1ca63443b0bdf64a0b433b5',
  '0x347830b4634737d28c396be0dca7739fc7284da7',
  '0xd2c0b9b797ab8659a8d1ad3c6f0facc02d671197',
  '0x5f101431196a325c127d5bef16367be6e6585e23',
  '0xf618f930084879478d1efb09ecc959f7859d5a74',
  '0x0447601803c37f1b7675d22750a0ca6a437de3ae',
  '0x1d5ec2c72402b76f40561a0c27296739f38000ad',
  '0x23cd62a48a10699999f66e359b8b5994ff86a449',
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

async function calculatePnLV53(wallet: string): Promise<{
  clobCash: number;
  ctfCash: number;
  totalCash: number;
  longWins: number;
  shortLosses: number;
  totalPnl: number;
  tradeCount: number;
  ctfOperations: number;
}> {
  const query = `
    WITH
      -- CLOB positions per (condition, outcome)
      clob_pos AS (
        SELECT
          m.condition_id,
          m.outcome_index,
          sumIf(t.token_amount / 1e6, t.side = 'buy') as clob_bought,
          sumIf(t.token_amount / 1e6, t.side = 'sell') as clob_sold,
          sumIf(t.usdc_amount / 1e6, t.side = 'sell') - sumIf(t.usdc_amount / 1e6, t.side = 'buy') as clob_cash
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${wallet}'
          AND m.condition_id != ''
        GROUP BY m.condition_id, m.outcome_index
      ),

      -- CTF positions - tokens per outcome, but cash ONLY for outcome_index = 0
      -- This fixes the double-counting: merges show cash on both outcomes but only give $1 per pair
      ctf_pos AS (
        SELECT
          condition_id,
          outcome_index,
          sum(shares_delta) as ctf_tokens,
          -- Only count cash for outcome 0 to avoid double-counting
          sumIf(cash_delta, outcome_index = 0) as ctf_cash
        FROM pm_ctf_split_merge_expanded
        WHERE lower(wallet) = '${wallet}'
        GROUP BY condition_id, outcome_index
      ),

      -- Combine CLOB + CTF
      combined AS (
        SELECT
          COALESCE(c.condition_id, f.condition_id) as condition_id,
          COALESCE(c.outcome_index, f.outcome_index) as outcome_index,
          -- Net tokens = CLOB bought - CLOB sold + CTF tokens
          COALESCE(c.clob_bought, 0) - COALESCE(c.clob_sold, 0) + COALESCE(f.ctf_tokens, 0) as net_tokens,
          -- Cash = CLOB cash + CTF cash (only counted once per merge)
          COALESCE(c.clob_cash, 0) as clob_cash_flow,
          COALESCE(f.ctf_cash, 0) as ctf_cash_flow
        FROM clob_pos c
        FULL OUTER JOIN ctf_pos f ON c.condition_id = f.condition_id AND c.outcome_index = f.outcome_index
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
          sum(clob_cash_flow) as total_clob_cash,
          sum(ctf_cash_flow) as total_ctf_cash,
          sum(clob_cash_flow) + sum(ctf_cash_flow) as total_cash,
          sumIf(net_tokens, net_tokens > 0 AND won = 1) as long_wins,
          sumIf(abs(net_tokens), net_tokens < 0 AND won = 1) as short_losses
        FROM with_res
      )

    SELECT
      round(total_clob_cash, 2) as clob_cash,
      round(total_ctf_cash, 2) as ctf_cash,
      round(total_cash, 2) as total_cash,
      round(long_wins, 2) as long_wins,
      round(short_losses, 2) as short_losses,
      round(total_cash + long_wins - short_losses, 2) as total_pnl,
      (SELECT count() FROM pm_trader_events_v3 WHERE lower(trader_wallet) = '${wallet}') as trade_count,
      (SELECT count() FROM pm_ctf_split_merge_expanded WHERE lower(wallet) = '${wallet}') as ctf_operations
    FROM agg
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = (await result.json() as any[])[0] || {};

  return {
    clobCash: Number(data.clob_cash) || 0,
    ctfCash: Number(data.ctf_cash) || 0,
    totalCash: Number(data.total_cash) || 0,
    longWins: Number(data.long_wins) || 0,
    shortLosses: Number(data.short_losses) || 0,
    totalPnl: Number(data.total_pnl) || 0,
    tradeCount: Number(data.trade_count) || 0,
    ctfOperations: Number(data.ctf_operations) || 0,
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log('PnL Engine V53 - CTF CASH DOUBLE-COUNT FIX');
  console.log('='.repeat(80));
  console.log('');
  console.log('Formula: PnL = Cash_flow + Long_wins - Short_losses');
  console.log('Fix: Only count CTF cash_delta for outcome_index = 0');
  console.log('     (Merges show cash on both outcomes but only give $1 per pair)');
  console.log('');

  const results: any[] = [];

  for (let i = 0; i < TEST_WALLETS.length; i++) {
    const wallet = TEST_WALLETS[i];
    console.log(`[${i + 1}/${TEST_WALLETS.length}] ${wallet.slice(0, 14)}...`);

    try {
      const pnl = await calculatePnLV53(wallet);
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

      console.log(`  CLOB Cash: $${pnl.clobCash.toFixed(2)} | CTF Cash: $${pnl.ctfCash.toFixed(2)} | Total Cash: $${pnl.totalCash.toFixed(2)}`);
      console.log(`  Long Wins: $${pnl.longWins.toFixed(2)} | Short Losses: $${pnl.shortLosses.toFixed(2)}`);
      console.log(`  Calc: $${pnl.totalPnl.toFixed(2)} | API: $${apiPnl.toFixed(2)} | Err: $${error.toFixed(2)} | ${status}`);
      console.log(`  (Trades: ${pnl.tradeCount}, CTF ops: ${pnl.ctfOperations})`);
      console.log('');

      results.push({
        wallet,
        ...pnl,
        apiPnl,
        error,
        absError,
        status,
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
  console.log(`  PASS (within $10): ${passed}/${results.length}`);
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
  console.log('-'.repeat(100));
  console.log('Wallet           | CLOB Cash  | CTF Cash   | LongWins  | ShortLoss | Calc      | API       | Err       | Status');
  console.log('-'.repeat(100));
  for (const r of results) {
    console.log(
      `${r.wallet.slice(0, 14)}... | ` +
      `${r.clobCash.toFixed(2).padStart(10)} | ` +
      `${r.ctfCash.toFixed(2).padStart(10)} | ` +
      `${r.longWins.toFixed(2).padStart(9)} | ` +
      `${r.shortLosses.toFixed(2).padStart(9)} | ` +
      `${r.totalPnl.toFixed(2).padStart(9)} | ` +
      `${r.apiPnl.toFixed(2).padStart(9)} | ` +
      `${r.error.toFixed(2).padStart(9)} | ` +
      `${r.status}`
    );
  }

  // Save results
  const fs = await import('fs');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(`scripts/pilot-results-v53-${timestamp}.json`, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to scripts/pilot-results-v53-*.json`);
}

main().catch(console.error);
