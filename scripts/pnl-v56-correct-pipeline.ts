/**
 * PnL Engine V56 - CORRECT THREE-STAGE PIPELINE
 *
 * Three distinct bugs fixed:
 *
 * 1. MIRRORED DUPLICATES (2x bug):
 *    - Same fill appears twice with role=maker and role=taker
 *    - Fix: Dedupe by economic signature (wallet, tx_hash, token_id, side, amount)
 *
 * 2. NEGRISK PAIRED TRADES (phantom short inversion):
 *    - Buy outcome A + Sell outcome B in same tx/condition
 *    - V54 BUG: Excluded maker (which was the BUY), kept taker (the phantom SELL)
 *    - Fix: For paired trades, KEEP the BUY, EXCLUDE the opposite-outcome SELL
 *
 * 3. CTF CASH (split cash included):
 *    - Splits are economically neutral (pay $X, get $X tokens)
 *    - Fix: Remove CTF cash_delta entirely from PnL
 *
 * FORMULA: PnL = CLOB_cash + Long_wins - Short_losses
 *   - CLOB_cash = sell_usdc - buy_usdc (after dedup and paired-trade collapse)
 *   - Long_wins = tokens LONG on WINNING outcomes
 *   - Short_losses = tokens SHORT on WINNING outcomes
 *   - CTF tokens included in positions, CTF cash NOT included
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

// Test wallets including the problematic ones
const TEST_WALLETS = [
  // Original V54 resolved-only (should still pass)
  '0x36a8b00a373f1d586fabaa6f17445a919189e507', // Was 2x error, fixed
  '0xfccaac5f10e7f3104eae2a648e0e943a0c9b5184', // Was 2x error, fixed
  '0xf618f930084879478d1efb09ecc959f7859d5a74', // Resolved, was passing

  // CTF-heavy wallet that had $741 error (fixed by removing CTF cash)
  '0xa277a0e326adc9cfa039a66dbab0b88f59ad28ad',

  // NegRisk paired-trade heavy wallets (should now be fixed)
  '0xbde28d6ec74ac86ae1ca63443b0bdf64a0b433b5', // Was $3864 error (28 open positions)
  '0xb7df7465a473195b622cdbf522e8643bf4874eeb', // Was $100 error

  // Additional resolved-only for validation
  '0x7531814b44f1ba3d733d89c609a1cd95131853b9',
  '0x03b5561abd6ba733c3d93420ff7f4ffb28560bdc',
  '0xe5ddd343733a26f42b635ec805661bfce60c7ff2',
  '0x35ed4e9bcf8c5515df70a758ef6b55975e4135a1',
];

async function getApiPnL(wallet: string): Promise<number> {
  try {
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    if (res.ok) {
      const data = await res.json() as Array<{ t: number; p: number }>;
      if (data && data.length > 0) {
        // FIX: Sort by timestamp and take the latest
        const sorted = [...data].sort((a, b) => b.t - a.t);
        return sorted[0].p || 0;
      }
    }
  } catch {}
  return 0;
}

async function calculatePnLV56(wallet: string): Promise<{
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
          -- Economic signature for dedup
          concat(t.transaction_hash, '_', m.condition_id, '_', toString(m.outcome_index), '_', t.side, '_', toString(t.token_amount)) as fill_signature
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${wallet}'
          AND m.condition_id != ''
      ),

      -- STAGE 2a: Identify MIRRORED duplicates
      -- Same fill appearing with both maker and taker roles (true 2x bug)
      mirrored_signatures AS (
        SELECT fill_signature
        FROM raw_trades
        GROUP BY fill_signature
        HAVING countDistinct(role) = 2  -- Both maker and taker for same fill
      ),

      -- STAGE 2b: Identify PAIRED TRADES
      -- Buy outcome A + Sell outcome B in same (tx, condition) = NegRisk pattern
      paired_tx_conditions AS (
        SELECT transaction_hash, condition_id
        FROM raw_trades
        GROUP BY transaction_hash, condition_id
        HAVING countDistinct(outcome_index) = 2  -- Both outcomes in same tx
          AND countIf(side = 'buy') > 0
          AND countIf(side = 'sell') > 0
      ),

      -- STAGE 3: Apply filters
      -- For mirrored: keep one (prefer taker)
      -- For paired trades: keep BUY, exclude opposite-outcome SELL
      filtered_trades AS (
        SELECT *
        FROM raw_trades t
        WHERE
          -- Mirrored dedup: if both roles exist for this signature, keep only taker
          NOT (
            t.fill_signature IN (SELECT fill_signature FROM mirrored_signatures)
            AND t.role = 'maker'
          )
          -- Paired trade fix: exclude SELL side of paired trades (phantom from implicit mint)
          AND NOT (
            (t.transaction_hash, t.condition_id) IN (SELECT transaction_hash, condition_id FROM paired_tx_conditions)
            AND t.side = 'sell'
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

      -- STAGE 5: CTF tokens only (NO CASH - splits are economically neutral)
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

      -- STAGE 7: Join resolutions (with proper NULL handling)
      with_res AS (
        SELECT
          cb.*,
          r.payout_numerators,
          -- FIX: Use empty string check for ClickHouse LEFT JOIN behavior
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
      (SELECT count() FROM paired_tx_conditions) as paired_trades,
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
  console.log('PnL Engine V56 - CORRECT THREE-STAGE PIPELINE');
  console.log('='.repeat(80));
  console.log('');
  console.log('THREE BUGS FIXED:');
  console.log('  1. Mirrored duplicates: Dedupe by economic signature');
  console.log('  2. Paired trades: Keep BUY, exclude opposite-outcome SELL');
  console.log('  3. CTF cash: Remove entirely (splits are neutral)');
  console.log('');
  console.log('FORMULA: PnL = CLOB_cash + Long_wins - Short_losses');
  console.log('');

  const results: any[] = [];

  for (let i = 0; i < TEST_WALLETS.length; i++) {
    const wallet = TEST_WALLETS[i];
    process.stdout.write(`[${String(i + 1).padStart(2)}/${TEST_WALLETS.length}] ${wallet.slice(0, 14)}... `);

    try {
      const [pnl, apiPnl] = await Promise.all([
        calculatePnLV56(wallet),
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
  const withOpen = results.filter(r => r.openPositions > 0);

  console.log(`\nResolved-only wallets (${resolvedOnly.length}):`);
  const passResolved = resolvedOnly.filter(r => r.absError <= 10).length;
  const closeResolved = resolvedOnly.filter(r => r.absError > 10 && r.absError <= 100).length;
  const failResolved = resolvedOnly.filter(r => r.absError > 100).length;
  console.log(`  PASS (within $10): ${passResolved}`);
  console.log(`  CLOSE (within $100): ${closeResolved}`);
  console.log(`  FAIL: ${failResolved}`);
  if (resolvedOnly.length > 0) {
    console.log(`  Accuracy: ${(100 * passResolved / resolvedOnly.length).toFixed(1)}%`);
  }

  console.log(`\nWallets with open positions (${withOpen.length}):`);
  const passOpen = withOpen.filter(r => r.absError <= 10).length;
  console.log(`  PASS (within $10): ${passOpen}`);
  console.log(`  (MTM mismatch expected for open positions)`);

  // Pipeline stats
  const totalMirrored = results.reduce((s, r) => s + r.mirroredDedups, 0);
  const totalPaired = results.reduce((s, r) => s + r.pairedTrades, 0);
  const totalCtf = results.reduce((s, r) => s + r.ctfOps, 0);
  console.log(`\nPipeline statistics:`);
  console.log(`  Mirrored duplicates deduped: ${totalMirrored}`);
  console.log(`  Paired trades collapsed: ${totalPaired}`);
  console.log(`  CTF operations (tokens only): ${totalCtf}`);

  // Show failures
  const failures = results.filter(r => r.status === 'FAIL' || r.status === 'FAIL_OPEN');
  if (failures.length > 0) {
    console.log(`\n${'!'.repeat(40)}`);
    console.log('FAILURES TO INVESTIGATE:');
    for (const f of failures) {
      console.log(`  ${f.wallet.slice(0, 14)}... | Err: $${f.error.toFixed(2)} | Mirror: ${f.mirroredDedups} | Paired: ${f.pairedTrades} | Open: ${f.openPositions}`);
    }
    console.log('!'.repeat(40));
  }

  // Save results
  const fs = await import('fs');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(`scripts/pilot-results-v56-${timestamp}.json`, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to scripts/pilot-results-v56-*.json`);
}

main().catch(console.error);
