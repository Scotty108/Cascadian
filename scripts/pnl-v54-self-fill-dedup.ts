/**
 * PnL Engine V54 - SELF-FILL DEDUPLICATION
 *
 * ROOT CAUSE FOUND: Self-fill trades (wallet is both maker AND taker)
 * were being counted TWICE, causing exactly 2x error.
 *
 * Fix: Exclude MAKER events from transactions where wallet is both maker AND taker.
 *
 * Also includes CTF cash fix: Only count cash_delta once per merge (outcome_index = 0).
 *
 * Formula: PnL = Cash_flow + Long_wins - Short_losses
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

// Test wallets - original 3 + 10 random
const TEST_WALLETS = [
  '0x36a8b00a373f1d586fabaa6f17445a919189e507', // Was err=$53, now should match
  '0xfccaac5f10e7f3104eae2a648e0e943a0c9b5184', // Was err=$10, now should match
  '0xb7df7465a473195b622cdbf522e8643bf4874eeb', // CTF heavy
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

async function calculatePnLV54(wallet: string): Promise<{
  clobCash: number;
  ctfCash: number;
  longWins: number;
  shortLosses: number;
  totalPnl: number;
  tradeCount: number;
  selfFillTxs: number;
  openPositions: number;
}> {
  const query = `
    WITH
      -- Step 1: Identify self-fill transactions (wallet is both maker AND taker)
      self_fills AS (
        SELECT transaction_hash
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${wallet}'
        GROUP BY transaction_hash
        HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
      ),

      -- Step 2: Get CLOB trades, excluding MAKER side of self-fills
      clob_trades AS (
        SELECT
          m.condition_id,
          m.outcome_index,
          t.side,
          t.token_amount / 1e6 as tokens,
          t.usdc_amount / 1e6 as usdc
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${wallet}'
          AND m.condition_id != ''
          -- CRITICAL: Exclude maker side of self-fills to avoid double-counting
          AND NOT (t.transaction_hash IN (SELECT transaction_hash FROM self_fills) AND t.role = 'maker')
      ),

      -- Step 3: Aggregate CLOB positions
      clob_pos AS (
        SELECT
          condition_id,
          outcome_index,
          sumIf(tokens, side = 'buy') as clob_bought,
          sumIf(tokens, side = 'sell') as clob_sold,
          sumIf(usdc, side = 'sell') - sumIf(usdc, side = 'buy') as clob_cash
        FROM clob_trades
        GROUP BY condition_id, outcome_index
      ),

      -- Step 4: CTF positions - tokens per outcome, cash ONLY for outcome_index = 0
      ctf_pos AS (
        SELECT
          condition_id,
          outcome_index,
          sum(shares_delta) as ctf_tokens,
          sumIf(cash_delta, outcome_index = 0) as ctf_cash
        FROM pm_ctf_split_merge_expanded
        WHERE lower(wallet) = '${wallet}'
        GROUP BY condition_id, outcome_index
      ),

      -- Step 5: Combine CLOB + CTF
      combined AS (
        SELECT
          COALESCE(c.condition_id, f.condition_id) as condition_id,
          COALESCE(c.outcome_index, f.outcome_index) as outcome_index,
          COALESCE(c.clob_bought, 0) - COALESCE(c.clob_sold, 0) + COALESCE(f.ctf_tokens, 0) as net_tokens,
          COALESCE(c.clob_cash, 0) as clob_cash_flow,
          COALESCE(f.ctf_cash, 0) as ctf_cash_flow
        FROM clob_pos c
        FULL OUTER JOIN ctf_pos f ON c.condition_id = f.condition_id AND c.outcome_index = f.outcome_index
      ),

      -- Step 6: Join resolutions
      with_res AS (
        SELECT
          cb.*,
          r.payout_numerators,
          r.condition_id IS NULL OR r.payout_numerators = '' as is_open,
          toInt64OrNull(JSONExtractString(r.payout_numerators, cb.outcome_index + 1)) = 1 as won
        FROM combined cb
        LEFT JOIN pm_condition_resolutions r ON cb.condition_id = r.condition_id AND r.is_deleted = 0
      ),

      -- Step 7: Aggregate final results
      agg AS (
        SELECT
          sum(clob_cash_flow) as total_clob_cash,
          sum(ctf_cash_flow) as total_ctf_cash,
          sumIf(net_tokens, net_tokens > 0 AND won = 1) as long_wins,
          sumIf(abs(net_tokens), net_tokens < 0 AND won = 1) as short_losses,
          countIf(is_open = 1 AND abs(net_tokens) > 0.01) as open_positions
        FROM with_res
      )

    SELECT
      round(total_clob_cash, 2) as clob_cash,
      round(total_ctf_cash, 2) as ctf_cash,
      round(long_wins, 2) as long_wins,
      round(short_losses, 2) as short_losses,
      round(total_clob_cash + total_ctf_cash + long_wins - short_losses, 2) as total_pnl,
      (SELECT count() FROM pm_trader_events_v3 WHERE lower(trader_wallet) = '${wallet}') as trade_count,
      (SELECT count() FROM self_fills) as self_fill_txs,
      open_positions
    FROM agg
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = (await result.json() as any[])[0] || {};

  return {
    clobCash: Number(data.clob_cash) || 0,
    ctfCash: Number(data.ctf_cash) || 0,
    longWins: Number(data.long_wins) || 0,
    shortLosses: Number(data.short_losses) || 0,
    totalPnl: Number(data.total_pnl) || 0,
    tradeCount: Number(data.trade_count) || 0,
    selfFillTxs: Number(data.self_fill_txs) || 0,
    openPositions: Number(data.open_positions) || 0,
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log('PnL Engine V54 - SELF-FILL DEDUPLICATION');
  console.log('='.repeat(80));
  console.log('');
  console.log('Fix: Exclude MAKER side of self-fill transactions');
  console.log('     (Self-fills = wallet is both maker AND taker in same tx)');
  console.log('');
  console.log('Formula: PnL = CLOB_cash + CTF_cash + Long_wins - Short_losses');
  console.log('');

  const results: any[] = [];

  for (let i = 0; i < TEST_WALLETS.length; i++) {
    const wallet = TEST_WALLETS[i];
    console.log(`[${i + 1}/${TEST_WALLETS.length}] ${wallet.slice(0, 14)}...`);

    try {
      const pnl = await calculatePnLV54(wallet);
      const apiPnl = await getApiPnL(wallet);
      const error = pnl.totalPnl - apiPnl;
      const absError = Math.abs(error);

      let status: string;
      if (pnl.openPositions > 0) {
        status = absError <= 10 ? 'PASS_OPEN' : 'FAIL_OPEN';
      } else if (absError <= 10) {
        status = 'PASS';
      } else if (absError <= 100) {
        status = 'CLOSE';
      } else {
        status = 'FAIL';
      }

      console.log(`  Cash: $${(pnl.clobCash + pnl.ctfCash).toFixed(2)} | LW: $${pnl.longWins.toFixed(2)} | SL: $${pnl.shortLosses.toFixed(2)}`);
      console.log(`  Calc: $${pnl.totalPnl.toFixed(2)} | API: $${apiPnl.toFixed(2)} | Err: $${error.toFixed(2)} | ${status}`);
      console.log(`  (Trades: ${pnl.tradeCount}, Self-fills: ${pnl.selfFillTxs}, Open: ${pnl.openPositions})`);
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

  const resolvedOnly = results.filter(r => r.openPositions === 0);
  const withOpen = results.filter(r => r.openPositions > 0);

  const passResolved = resolvedOnly.filter(r => r.absError <= 10).length;
  const closeResolved = resolvedOnly.filter(r => r.absError > 10 && r.absError <= 100).length;
  const failResolved = resolvedOnly.filter(r => r.absError > 100).length;

  console.log(`\nResolved-only wallets (${resolvedOnly.length}):`);
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

  // Error distribution for resolved
  if (resolvedOnly.length > 0) {
    const errors = resolvedOnly.map(r => r.absError).sort((a, b) => a - b);
    console.log(`\nError distribution (resolved only):`);
    console.log(`  Min: $${errors[0]?.toFixed(2)}`);
    console.log(`  Median: $${errors[Math.floor(errors.length / 2)]?.toFixed(2)}`);
    console.log(`  Max: $${errors[errors.length - 1]?.toFixed(2)}`);
  }

  // Self-fill stats
  const totalSelfFills = results.reduce((s, r) => s + r.selfFillTxs, 0);
  console.log(`\nSelf-fill statistics:`);
  console.log(`  Total self-fill transactions: ${totalSelfFills}`);
  console.log(`  Wallets with self-fills: ${results.filter(r => r.selfFillTxs > 0).length}/${results.length}`);

  // Detailed results
  console.log(`\nDetailed results:`);
  console.log('-'.repeat(110));
  console.log('Wallet           | Cash       | LongWins  | ShortLoss | Calc      | API       | Err       | SelfFill | Open | Status');
  console.log('-'.repeat(110));
  for (const r of results) {
    console.log(
      `${r.wallet.slice(0, 14)}... | ` +
      `${(r.clobCash + r.ctfCash).toFixed(2).padStart(10)} | ` +
      `${r.longWins.toFixed(2).padStart(9)} | ` +
      `${r.shortLosses.toFixed(2).padStart(9)} | ` +
      `${r.totalPnl.toFixed(2).padStart(9)} | ` +
      `${r.apiPnl.toFixed(2).padStart(9)} | ` +
      `${r.error.toFixed(2).padStart(9)} | ` +
      `${String(r.selfFillTxs).padStart(8)} | ` +
      `${String(r.openPositions).padStart(4)} | ` +
      `${r.status}`
    );
  }

  // Save results
  const fs = await import('fs');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(`scripts/pilot-results-v54-${timestamp}.json`, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to scripts/pilot-results-v54-*.json`);
}

main().catch(console.error);
