/**
 * PnL Engine V57 - REFINED PAIRED TRADE DETECTION
 *
 * V56 was too aggressive - excluded ALL sells in paired-trade transactions.
 * But not every buy+sell in same tx is a NegRisk phantom!
 *
 * TRUE NegRisk Pattern (should exclude sell):
 * - Buy X tokens on outcome A
 * - Sell X tokens on outcome B (equal amounts)
 * - Prices complement: buy_price + sell_price ≈ $1
 *
 * LEGITIMATE Rebalance (should keep both):
 * - Buy Y tokens on outcome A
 * - Sell Z tokens on outcome B (different amounts)
 *
 * FIX: Only collapse paired trades where token amounts match within 1%
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

// Test wallets - focus on the failures
const TEST_WALLETS = [
  // V54 wallets that passed - should still pass
  '0x36a8b00a373f1d586fabaa6f17445a919189e507',
  '0xfccaac5f10e7f3104eae2a648e0e943a0c9b5184',

  // V56 failures to investigate
  '0xb7df7465a473195b622cdbf522e8643bf4874eeb', // $1078 error, 24 CTF ops
  '0xe5ddd343733a26f42b635ec805661bfce60c7ff2', // $215 error, 88 paired

  // CTF-heavy that passed in V56
  '0xa277a0e326adc9cfa039a66dbab0b88f59ad28ad',

  // Additional resolved wallets
  '0x03b5561abd6ba733c3d93420ff7f4ffb28560bdc',
  '0x35ed4e9bcf8c5515df70a758ef6b55975e4135a1',
  '0x7531814b44f1ba3d733d89c609a1cd95131853b9',
];

async function getApiPnL(wallet: string): Promise<number> {
  try {
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    if (res.ok) {
      const data = await res.json() as Array<{ t: number; p: number }>;
      if (data && data.length > 0) {
        const sorted = [...data].sort((a, b) => b.t - a.t);
        return sorted[0].p || 0;
      }
    }
  } catch {}
  return 0;
}

async function calculatePnLV57(wallet: string): Promise<{
  clobCash: number;
  longWins: number;
  shortLosses: number;
  totalPnl: number;
  tradeCount: number;
  mirroredDedups: number;
  pairedTrades: number;
  ctfOps: number;
  openPositions: number;
}> {
  const query = `
    WITH
      -- STAGE 1: Raw trades with mapping
      raw_trades AS (
        SELECT
          t.event_id,
          t.transaction_hash,
          m.condition_id,
          m.outcome_index,
          t.side,
          t.role,
          t.token_amount / 1e6 as tokens,
          t.usdc_amount / 1e6 as usdc,
          concat(t.transaction_hash, '_', m.condition_id, '_', toString(m.outcome_index), '_', t.side, '_', toString(t.token_amount)) as fill_signature
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${wallet}'
          AND m.condition_id != ''
      ),

      -- STAGE 2a: Identify MIRRORED duplicates (true 2x bug)
      mirrored_signatures AS (
        SELECT fill_signature
        FROM raw_trades
        GROUP BY fill_signature
        HAVING countDistinct(role) = 2
      ),

      -- STAGE 2b: Identify TRUE NegRisk paired trades
      -- Must have: buy on one outcome, sell on other, with MATCHING token amounts
      tx_condition_summary AS (
        SELECT
          transaction_hash,
          condition_id,
          sumIf(tokens, side = 'buy' AND outcome_index = 0) as buy_0,
          sumIf(tokens, side = 'buy' AND outcome_index = 1) as buy_1,
          sumIf(tokens, side = 'sell' AND outcome_index = 0) as sell_0,
          sumIf(tokens, side = 'sell' AND outcome_index = 1) as sell_1
        FROM raw_trades
        GROUP BY transaction_hash, condition_id
      ),

      -- Only consider it a NegRisk paired trade if amounts match within 1%
      -- Pattern: (buy_0 > 0 AND sell_1 > 0 AND abs(buy_0 - sell_1) < 0.01 * buy_0)
      -- OR: (buy_1 > 0 AND sell_0 > 0 AND abs(buy_1 - sell_0) < 0.01 * buy_1)
      true_paired_trades AS (
        SELECT transaction_hash, condition_id,
          CASE
            WHEN buy_0 > 0 AND sell_1 > 0 AND abs(buy_0 - sell_1) / buy_0 < 0.01 THEN 1  -- Buy 0, Sell 1
            WHEN buy_1 > 0 AND sell_0 > 0 AND abs(buy_1 - sell_0) / buy_1 < 0.01 THEN 0  -- Buy 1, Sell 0
            ELSE -1  -- Not a true paired trade
          END as sell_outcome_to_exclude
        FROM tx_condition_summary
        WHERE
          (buy_0 > 0 AND sell_1 > 0 AND abs(buy_0 - sell_1) / greatest(buy_0, 0.01) < 0.01)
          OR (buy_1 > 0 AND sell_0 > 0 AND abs(buy_1 - sell_0) / greatest(buy_1, 0.01) < 0.01)
      ),

      -- STAGE 3: Apply filters
      filtered_trades AS (
        SELECT r.*
        FROM raw_trades r
        LEFT JOIN true_paired_trades p ON r.transaction_hash = p.transaction_hash AND r.condition_id = p.condition_id
        WHERE
          -- Mirrored dedup: keep only taker when both roles exist
          NOT (
            r.fill_signature IN (SELECT fill_signature FROM mirrored_signatures)
            AND r.role = 'maker'
          )
          -- Paired trade: only exclude the specific SELL outcome that matches
          AND NOT (
            p.sell_outcome_to_exclude >= 0
            AND r.side = 'sell'
            AND r.outcome_index = p.sell_outcome_to_exclude
          )
      ),

      -- STAGE 4: Aggregate CLOB positions
      clob_pos AS (
        SELECT
          condition_id,
          outcome_index,
          sumIf(tokens, side = 'buy') - sumIf(tokens, side = 'sell') as clob_tokens,
          sumIf(usdc, side = 'sell') - sumIf(usdc, side = 'buy') as clob_cash
        FROM filtered_trades
        GROUP BY condition_id, outcome_index
      ),

      -- STAGE 5: CTF tokens only (NO CASH)
      ctf_tokens AS (
        SELECT condition_id, outcome_index, sum(shares_delta) as ctf_tokens
        FROM pm_ctf_split_merge_expanded
        WHERE lower(wallet) = '${wallet}'
        GROUP BY condition_id, outcome_index
      ),

      -- STAGE 6: Combine CLOB + CTF
      combined AS (
        SELECT
          COALESCE(c.condition_id, f.condition_id) as condition_id,
          COALESCE(c.outcome_index, f.outcome_index) as outcome_index,
          COALESCE(c.clob_tokens, 0) + COALESCE(f.ctf_tokens, 0) as net_tokens,
          COALESCE(c.clob_cash, 0) as cash_flow
        FROM clob_pos c
        FULL OUTER JOIN ctf_tokens f ON c.condition_id = f.condition_id AND c.outcome_index = f.outcome_index
      ),

      -- STAGE 7: Join resolutions
      with_res AS (
        SELECT
          cb.*,
          r.payout_numerators,
          r.condition_id = '' OR r.payout_numerators = '' as is_open,
          toInt64OrNull(JSONExtractString(r.payout_numerators, cb.outcome_index + 1)) = 1 as won
        FROM combined cb
        LEFT JOIN pm_condition_resolutions r ON cb.condition_id = r.condition_id AND r.is_deleted = 0
      ),

      -- STAGE 8: Aggregate results
      agg AS (
        SELECT
          sum(cash_flow) as clob_cash,
          sumIf(net_tokens, net_tokens > 0 AND won = 1) as long_wins,
          sumIf(abs(net_tokens), net_tokens < 0 AND won = 1) as short_losses,
          countIf(is_open = 1 AND abs(net_tokens) > 0.01) as open_positions
        FROM with_res
      )

    SELECT
      round(clob_cash, 2) as clob_cash,
      round(long_wins, 2) as long_wins,
      round(short_losses, 2) as short_losses,
      round(clob_cash + long_wins - short_losses, 2) as total_pnl,
      (SELECT count() FROM raw_trades) as trade_count,
      (SELECT count() FROM mirrored_signatures) as mirrored_dedups,
      (SELECT count() FROM true_paired_trades WHERE sell_outcome_to_exclude >= 0) as paired_trades,
      (SELECT count() FROM pm_ctf_split_merge_expanded WHERE lower(wallet) = '${wallet}') as ctf_ops,
      open_positions
    FROM agg
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = (await result.json() as any[])[0] || {};

  return {
    clobCash: Number(data.clob_cash) || 0,
    longWins: Number(data.long_wins) || 0,
    shortLosses: Number(data.short_losses) || 0,
    totalPnl: Number(data.total_pnl) || 0,
    tradeCount: Number(data.trade_count) || 0,
    mirroredDedups: Number(data.mirrored_dedups) || 0,
    pairedTrades: Number(data.paired_trades) || 0,
    ctfOps: Number(data.ctf_ops) || 0,
    openPositions: Number(data.open_positions) || 0,
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log('PnL Engine V57 - REFINED PAIRED TRADE DETECTION');
  console.log('='.repeat(80));
  console.log('');
  console.log('V56 was too aggressive - excluded ALL sells in paired-trade txs.');
  console.log('V57 FIX: Only exclude sells where amounts MATCH the buy (within 1%)');
  console.log('');

  const results: any[] = [];

  for (let i = 0; i < TEST_WALLETS.length; i++) {
    const wallet = TEST_WALLETS[i];
    process.stdout.write(`[${String(i + 1).padStart(2)}/${TEST_WALLETS.length}] ${wallet.slice(0, 14)}... `);

    try {
      const [pnl, apiPnl] = await Promise.all([
        calculatePnLV57(wallet),
        getApiPnL(wallet),
      ]);

      const error = pnl.totalPnl - apiPnl;
      const absError = Math.abs(error);

      let status: string;
      if (pnl.openPositions > 0) {
        status = absError <= 10 ? 'PASS_OPEN' : absError <= 100 ? 'CLOSE_OPEN' : 'FAIL_OPEN';
      } else if (absError <= 10) {
        status = 'PASS';
      } else if (absError <= 100) {
        status = 'CLOSE';
      } else {
        status = 'FAIL';
      }

      console.log(`Calc: ${pnl.totalPnl.toFixed(2).padStart(10)} | API: ${apiPnl.toFixed(2).padStart(10)} | Err: ${error.toFixed(2).padStart(10)} | ${status}`);
      console.log(`       Mirror: ${pnl.mirroredDedups} | Paired: ${pnl.pairedTrades} | CTF: ${pnl.ctfOps} | Open: ${pnl.openPositions}`);

      results.push({ wallet, ...pnl, apiPnl, error, absError, status });
    } catch (err) {
      console.log(`ERROR: ${err}`);
    }
  }

  // Summary
  console.log('');
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const resolvedOnly = results.filter(r => r.openPositions === 0);
  const passResolved = resolvedOnly.filter(r => r.absError <= 10).length;
  console.log(`\nResolved-only: ${passResolved}/${resolvedOnly.length} PASS (${(100 * passResolved / Math.max(resolvedOnly.length, 1)).toFixed(1)}%)`);

  const failures = results.filter(r => (r.openPositions === 0 && r.absError > 10) || r.status.includes('FAIL'));
  if (failures.length > 0) {
    console.log(`\nFailures to investigate:`);
    for (const f of failures) {
      console.log(`  ${f.wallet.slice(0, 14)}... | Err: $${f.error.toFixed(2)} | Open: ${f.openPositions}`);
    }
  }

  const fs = await import('fs');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(`scripts/pilot-results-v57-${timestamp}.json`, JSON.stringify(results, null, 2));
}

main().catch(console.error);
