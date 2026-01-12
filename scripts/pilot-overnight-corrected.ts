/**
 * CORRECTED Overnight Pilot - PnL Engine V46
 *
 * Fixes from GPT/Claude review:
 * 1. Self-fill collapse at (wallet, tx_hash, token_id) level, NOT event level
 * 2. Position tracking INCLUDES CTF splits/merges (not CLOB-only)
 * 3. Proper phantom detection on CLOB+CTF union
 *
 * Runs on 50 random wallets to validate approach overnight.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

interface WalletResult {
  wallet: string;
  trades: number;
  clobPnl: number;
  ctfAdjustment: number;
  totalCalcPnl: number;
  apiPnl: number;
  error: number;
  absError: number;
  phantomPositions: number;
  openPositions: number;
  hasNegRisk: boolean;
  status: 'pass' | 'fail' | 'gated';
}

async function getApiPnL(wallet: string): Promise<number> {
  try {
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    if (res.ok) {
      const data = await res.json() as Array<{ t: number; p: number }>;
      if (data && data.length > 0) {
        return data[data.length - 1].p || 0;
      }
    }
  } catch {
    // API failed
  }
  return 0;
}

async function calculateWalletPnL(wallet: string): Promise<{
  clobCashFlow: number;
  clobLongWins: number;
  clobShortLosses: number;
  ctfCashDelta: number;
  ctfSharesDelta: number;
  totalPnl: number;
  tradeCount: number;
  openPositionCount: number;
  phantomCount: number;
  hasNegRisk: boolean;
}> {
  // CORRECTED: Self-fill collapse at (wallet, tx_hash, token_id) level
  // Only collapse the OVERLAPPING portion of same-token buys/sells in same tx
  const query = `
    WITH
      -- Step 1: Aggregate trades at (tx_hash, token_id) level to find self-trades
      tx_token_summary AS (
        SELECT
          transaction_hash as tx_hash,
          token_id,
          sumIf(token_amount / 1e6, side = 'buy') as buy_tokens,
          sumIf(token_amount / 1e6, side = 'sell') as sell_tokens,
          sumIf(usdc_amount / 1e6, side = 'buy') as buy_usdc,
          sumIf(usdc_amount / 1e6, side = 'sell') as sell_usdc,
          least(buy_tokens, sell_tokens) as paired_tokens
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${wallet}'
        GROUP BY transaction_hash, token_id
      ),

      -- Step 2: Calculate net (unpaired) trading per token
      -- This removes the self-traded portion
      canonical_by_token AS (
        SELECT
          token_id,
          sum(buy_tokens - paired_tokens) as net_buy_tokens,
          sum(sell_tokens - paired_tokens) as net_sell_tokens,
          sum(buy_usdc * (1 - if(buy_tokens > 0, paired_tokens / buy_tokens, 0))) as net_buy_usdc,
          sum(sell_usdc * (1 - if(sell_tokens > 0, paired_tokens / sell_tokens, 0))) as net_sell_usdc
        FROM tx_token_summary
        GROUP BY token_id
      ),

      -- Step 3: Map to conditions and calculate positions
      positions AS (
        SELECT
          m.condition_id,
          m.outcome_index,
          sum(c.net_buy_tokens - c.net_sell_tokens) as net_tokens_clob,
          sum(c.net_sell_usdc - c.net_buy_usdc) as cash_flow_clob
        FROM canonical_by_token c
        JOIN pm_token_to_condition_map_v5 m ON c.token_id = m.token_id_dec
        WHERE m.condition_id != ''
        GROUP BY m.condition_id, m.outcome_index
      ),

      -- Step 4: Add CTF splits/merges (these give tokens without CLOB trades)
      ctf_positions AS (
        SELECT
          condition_id,
          outcome_index,
          sum(shares_delta) as shares_from_ctf,
          sum(cash_delta) as cash_from_ctf
        FROM pm_ctf_split_merge_expanded
        WHERE lower(wallet) = '${wallet}'
        GROUP BY condition_id, outcome_index
      ),

      -- Step 5: Combined positions (CLOB + CTF)
      combined AS (
        SELECT
          COALESCE(p.condition_id, c.condition_id) as condition_id,
          COALESCE(p.outcome_index, c.outcome_index) as outcome_index,
          COALESCE(p.net_tokens_clob, 0) as tokens_clob,
          COALESCE(p.cash_flow_clob, 0) as cash_clob,
          COALESCE(c.shares_from_ctf, 0) as tokens_ctf,
          COALESCE(c.cash_from_ctf, 0) as cash_ctf,
          COALESCE(p.net_tokens_clob, 0) + COALESCE(c.shares_from_ctf, 0) as total_tokens,
          COALESCE(p.cash_flow_clob, 0) + COALESCE(c.cash_from_ctf, 0) as total_cash
        FROM positions p
        FULL OUTER JOIN ctf_positions c
          ON p.condition_id = c.condition_id AND p.outcome_index = c.outcome_index
      ),

      -- Step 6: Join resolutions and calculate PnL
      with_res AS (
        SELECT
          cb.*,
          r.payout_numerators,
          toInt64OrNull(JSONExtractString(r.payout_numerators, cb.outcome_index + 1)) = 1 as won,
          r.condition_id IS NULL OR r.payout_numerators = '' as is_open
        FROM combined cb
        LEFT JOIN pm_condition_resolutions r
          ON cb.condition_id = r.condition_id AND r.is_deleted = 0
      ),

      -- Step 7: Check NegRisk
      negrisk AS (
        SELECT count() as nr_count
        FROM pm_neg_risk_conversions_v1
        WHERE lower(user_address) = '${wallet}'
      )

    SELECT
      sum(cash_clob) as clob_cash_flow,
      sumIf(tokens_clob, tokens_clob > 0 AND won = 1) as clob_long_wins,
      sumIf(-tokens_clob, tokens_clob < 0 AND won = 1) as clob_short_losses,
      sum(cash_ctf) as ctf_cash_delta,
      sum(tokens_ctf) as ctf_shares_delta,
      -- Total PnL: CLOB cash flow + CLOB wins - CLOB losses + CTF adjustments
      sum(total_cash) +
        sumIf(total_tokens, total_tokens > 0 AND won = 1) -
        sumIf(-total_tokens, total_tokens < 0 AND won = 1) as total_pnl,
      (SELECT count() FROM pm_trader_events_v3 WHERE lower(trader_wallet) = '${wallet}') as trade_count,
      countIf(abs(total_tokens) > 0.01 AND is_open = 1) as open_positions,
      -- Phantom: AFTER CTF union, any position where we sold more than total acquired
      countIf(tokens_clob + tokens_ctf < -0.01) as phantom_count,
      (SELECT nr_count FROM negrisk) as has_negrisk
    FROM with_res
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = (await result.json() as any[])[0] || {};

  return {
    clobCashFlow: Number(data.clob_cash_flow) || 0,
    clobLongWins: Number(data.clob_long_wins) || 0,
    clobShortLosses: Number(data.clob_short_losses) || 0,
    ctfCashDelta: Number(data.ctf_cash_delta) || 0,
    ctfSharesDelta: Number(data.ctf_shares_delta) || 0,
    totalPnl: Number(data.total_pnl) || 0,
    tradeCount: Number(data.trade_count) || 0,
    openPositionCount: Number(data.open_positions) || 0,
    phantomCount: Number(data.phantom_count) || 0,
    hasNegRisk: Number(data.has_negrisk) > 0,
  };
}

async function selectPilotWallets(count: number): Promise<string[]> {
  // Select diverse wallets with 50-500 trades (medium activity)
  const query = `
    SELECT DISTINCT lower(trader_wallet) as wallet
    FROM pm_trader_events_v3
    WHERE trade_time >= now() - INTERVAL 60 DAY
    GROUP BY trader_wallet
    HAVING count() BETWEEN 50 AND 500
    ORDER BY rand()
    LIMIT ${count}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  return rows.map(r => r.wallet);
}

async function runPilot() {
  console.log('='.repeat(80));
  console.log('CORRECTED Overnight Pilot - PnL Engine V46');
  console.log('='.repeat(80));
  console.log('');
  console.log('Corrections applied:');
  console.log('  1. Self-fill collapse at (wallet, tx_hash, token_id) level');
  console.log('  2. Position tracking includes CTF splits/merges');
  console.log('  3. Phantom detection on CLOB+CTF union');
  console.log('');

  // Select 50 random wallets
  console.log('Selecting 50 random wallets with 50-500 trades...');
  const wallets = await selectPilotWallets(50);
  console.log(`Selected ${wallets.length} wallets\n`);

  const results: WalletResult[] = [];
  let processed = 0;

  for (const wallet of wallets) {
    processed++;
    process.stdout.write(`[${processed}/${wallets.length}] ${wallet.slice(0, 10)}... `);

    try {
      const pnl = await calculateWalletPnL(wallet);
      const apiPnl = await getApiPnL(wallet);

      const error = pnl.totalPnl - apiPnl;
      const absError = Math.abs(error);

      // Determine status
      let status: 'pass' | 'fail' | 'gated';
      if (pnl.hasNegRisk) {
        status = 'gated';
      } else if (pnl.phantomCount > 0) {
        status = 'gated';
      } else if (absError <= 10) {
        status = 'pass';
      } else {
        status = 'fail';
      }

      results.push({
        wallet,
        trades: pnl.tradeCount,
        clobPnl: pnl.clobCashFlow + pnl.clobLongWins - pnl.clobShortLosses,
        ctfAdjustment: pnl.ctfCashDelta,
        totalCalcPnl: pnl.totalPnl,
        apiPnl,
        error,
        absError,
        phantomPositions: pnl.phantomCount,
        openPositions: pnl.openPositionCount,
        hasNegRisk: pnl.hasNegRisk,
        status,
      });

      const statusStr = status.toUpperCase().padEnd(6);
      const errStr = error >= 0 ? `+${error.toFixed(2)}` : error.toFixed(2);
      console.log(
        `${statusStr} | Calc: ${pnl.totalPnl.toFixed(2).padStart(12)} | ` +
        `API: ${apiPnl.toFixed(2).padStart(12)} | ` +
        `Err: ${errStr.padStart(12)} | ` +
        `Ph: ${pnl.phantomCount} | Open: ${pnl.openPositionCount} | NR: ${pnl.hasNegRisk ? 'Y' : 'N'}`
      );
    } catch (err) {
      console.log(`ERROR: ${err}`);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 300));
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const gated = results.filter(r => r.status === 'gated').length;
  const gatedNegRisk = results.filter(r => r.hasNegRisk).length;
  const gatedPhantom = results.filter(r => !r.hasNegRisk && r.phantomCount > 0).length;

  const ungated = results.filter(r => r.status !== 'gated');
  const ungatedPassed = ungated.filter(r => r.absError <= 10).length;
  const ungatedWithin100 = ungated.filter(r => r.absError <= 100).length;

  console.log(`\nTotal: ${results.length}`);
  console.log(`  Passed (within $10): ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Gated: ${gated}`);
  console.log(`    - NegRisk: ${gatedNegRisk}`);
  console.log(`    - Phantom (after CTF): ${gatedPhantom}`);

  if (ungated.length > 0) {
    console.log(`\nUngated wallets: ${ungated.length}`);
    console.log(`  Within $10:  ${ungatedPassed}/${ungated.length} (${(100 * ungatedPassed / ungated.length).toFixed(1)}%)`);
    console.log(`  Within $100: ${ungatedWithin100}/${ungated.length} (${(100 * ungatedWithin100 / ungated.length).toFixed(1)}%)`);

    // Error distribution
    const errors = ungated.map(r => r.absError).sort((a, b) => a - b);
    console.log(`\nError distribution (ungated):`);
    console.log(`  Min:    $${errors[0]?.toFixed(2)}`);
    console.log(`  Median: $${errors[Math.floor(errors.length / 2)]?.toFixed(2)}`);
    console.log(`  Max:    $${errors[errors.length - 1]?.toFixed(2)}`);
  }

  // Show failures with details
  const failures = results.filter(r => r.status === 'fail');
  if (failures.length > 0) {
    console.log('\nFailures (need investigation):');
    for (const f of failures.sort((a, b) => b.absError - a.absError).slice(0, 10)) {
      const mtmNote = f.openPositions > 0 ? ` [${f.openPositions} open - MTM?]` : '';
      console.log(`  ${f.wallet.slice(0, 12)}... err=$${f.error.toFixed(2)}, trades=${f.trades}${mtmNote}`);
    }
  }

  // Gate check
  console.log('\n' + '='.repeat(80));
  if (ungated.length >= 15 && ungatedPassed / ungated.length >= 0.9) {
    console.log('PILOT PASSED - Ready for production');
  } else if (ungated.length >= 15 && ungatedWithin100 / ungated.length >= 0.9) {
    console.log('PILOT PARTIAL PASS - 90%+ within $100');
    console.log('Likely cause: MTM needed for open positions');
  } else if (ungated.length < 15) {
    console.log('PILOT INCONCLUSIVE - Too many gated wallets');
    console.log(`Only ${ungated.length} ungated wallets (need 15+)`);
  } else {
    console.log('PILOT NEEDS WORK');
    console.log(`Within $10: ${(100 * ungatedPassed / ungated.length).toFixed(1)}%`);
  }
  console.log('='.repeat(80));

  // Save results to file
  const fs = await import('fs');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsPath = `/Users/scotty/Projects/Cascadian-app/scripts/pilot-results-${timestamp}.json`;
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to: ${resultsPath}`);
}

runPilot().catch(console.error);
