/**
 * PnL Engine V51 - PAIRED TRADE FIX
 *
 * Key insight: "Phantom" positions are actually atomic mint-sell operations
 * where the CLOB internally does a CTF split and the wallet immediately sells one side.
 *
 * Detection: Same (wallet, tx_hash, condition_id) with BUY on outcome X and SELL on outcome (1-X)
 *
 * Fix: Net out paired trades before calculating positions:
 * - The SELL tokens came from implicit mint (not phantom)
 * - Net position = tokens on the side you're keeping
 * - Net cash = sell_usdc - buy_usdc
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

// 10 gated wallets from V50 pilot with varying phantom counts
const TEST_WALLETS = [
  '0x36a8b00a373f1d586fabaa6f17445a919189e507', // Ph=4, err=$53
  '0xfccaac5f10e7f3104eae2a648e0e943a0c9b5184', // Ph=4, err=$10
  '0xb7df7465a473195b622cdbf522e8643bf4874eeb', // Ph=2, err=$1089 (has CTF)
  '0x600b4b5d639099c02c1c7de09bce59adf857e8fb', // Ph=3
  '0x44b0c095a54667270d144ee39c6f9a6fa6e9b703', // Ph=2
  '0x7a72b757a3ee6ea89e2a2e37fe4dce51baca21d3', // Ph=2, err=$16
  '0x24c0321e4a6e1b5ee9dc59e0ebff4e9f66eb9862', // Ph=6
  '0x85e24fc79f62d1d3ce7c161f25956e31a34dcfea', // Ph=5
  '0xc9d8bf0c236a8a389355623eefc17801feabb5b0', // Ph=3
  '0x0ef2e6592dcd1e109fe8e02e7a9243aa6d834039', // Ph=1
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

async function calculatePnLWithPairedFix(wallet: string): Promise<{
  rawPhantom: number;
  fixedPhantom: number;
  pairedTrades: number;
  clobCashFlow: number;
  longWins: number;
  shortLosses: number;
  totalPnl: number;
  tradeCount: number;
}> {
  // V51: Handle paired trades by netting at (tx_hash, condition_id) level
  const query = `
    WITH
      -- Step 1: Get all trades with tx_hash for pairing detection
      raw_trades AS (
        SELECT
          t.transaction_hash,
          m.condition_id,
          m.outcome_index,
          t.side,
          t.token_amount / 1e6 as tokens,
          t.usdc_amount / 1e6 as usdc
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${wallet}'
          AND m.condition_id != ''
      ),

      -- Step 2: Identify paired trades (same tx, same condition, both outcomes traded)
      tx_condition_summary AS (
        SELECT
          transaction_hash,
          condition_id,
          sumIf(tokens, side = 'buy' AND outcome_index = 0) as buy_0,
          sumIf(tokens, side = 'buy' AND outcome_index = 1) as buy_1,
          sumIf(tokens, side = 'sell' AND outcome_index = 0) as sell_0,
          sumIf(tokens, side = 'sell' AND outcome_index = 1) as sell_1,
          sumIf(usdc, side = 'buy') as total_buy_usdc,
          sumIf(usdc, side = 'sell') as total_sell_usdc,
          -- Detect paired: has buys on one outcome AND sells on the other
          (buy_0 > 0 AND sell_1 > 0) OR (buy_1 > 0 AND sell_0 > 0) as is_paired
        FROM raw_trades
        GROUP BY transaction_hash, condition_id
      ),

      -- Step 3: For paired trades, calculate net position correctly
      -- Paired trade = synthetic split: you end up with tokens on ONE side only
      -- The "sold" side's tokens came from the implicit mint
      adjusted_positions AS (
        SELECT
          condition_id,
          -- For paired trades: net tokens = buy_side - implicit_mint_consumed
          -- If bought outcome 0 and sold outcome 1: you have outcome 0 tokens
          -- If bought outcome 1 and sold outcome 0: you have outcome 1 tokens
          sumIf(
            CASE
              WHEN is_paired AND buy_0 > 0 THEN buy_0 - least(buy_0, sell_1)  -- kept outcome 0
              WHEN NOT is_paired THEN buy_0
              ELSE 0
            END, true
          ) - sumIf(
            CASE
              WHEN is_paired AND sell_0 > 0 AND buy_1 > 0 THEN 0  -- sell was from implicit mint
              WHEN NOT is_paired THEN sell_0
              ELSE 0
            END, true
          ) as net_tokens_0,

          sumIf(
            CASE
              WHEN is_paired AND buy_1 > 0 THEN buy_1 - least(buy_1, sell_0)  -- kept outcome 1
              WHEN NOT is_paired THEN buy_1
              ELSE 0
            END, true
          ) - sumIf(
            CASE
              WHEN is_paired AND sell_1 > 0 AND buy_0 > 0 THEN 0  -- sell was from implicit mint
              WHEN NOT is_paired THEN sell_1
              ELSE 0
            END, true
          ) as net_tokens_1,

          -- Cash flow is always: sell_usdc - buy_usdc (regardless of pairing)
          sum(total_sell_usdc - total_buy_usdc) as cash_flow,

          -- Count paired transactions
          countIf(is_paired) as paired_count

        FROM tx_condition_summary
        GROUP BY condition_id
      ),

      -- Step 4: Unpivot to (condition_id, outcome_index, net_tokens)
      positions_unpivoted AS (
        SELECT condition_id, 0 as outcome_index, net_tokens_0 as net_tokens, cash_flow, paired_count
        FROM adjusted_positions
        UNION ALL
        SELECT condition_id, 1 as outcome_index, net_tokens_1 as net_tokens, 0 as cash_flow, 0 as paired_count
        FROM adjusted_positions
      ),

      -- Step 5: Join resolutions
      with_res AS (
        SELECT
          p.*,
          r.payout_numerators,
          r.condition_id IS NULL OR r.payout_numerators = '' as is_open,
          toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1 as won
        FROM positions_unpivoted p
        LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id AND r.is_deleted = 0
      ),

      -- Step 6: Also compute raw phantom count (before fix) for comparison
      raw_positions AS (
        SELECT
          m.condition_id,
          m.outcome_index,
          sumIf(t.token_amount / 1e6, t.side = 'buy') as bought,
          sumIf(t.token_amount / 1e6, t.side = 'sell') as sold
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${wallet}' AND m.condition_id != ''
        GROUP BY m.condition_id, m.outcome_index
      )

    SELECT
      -- Raw phantom (before fix)
      (SELECT countIf(sold > bought * 1.01) FROM raw_positions) as raw_phantom,

      -- Fixed phantom (after paired trade netting)
      countIf(net_tokens < -0.01) as fixed_phantom,

      -- Number of paired trades detected
      sum(paired_count) as paired_trades,

      -- PnL components
      sum(cash_flow) as clob_cash_flow,
      sumIf(net_tokens, net_tokens > 0 AND won = 1) as long_wins,
      sumIf(-net_tokens, net_tokens < 0 AND won = 1) as short_losses,

      -- Total PnL
      sum(cash_flow) + sumIf(net_tokens, net_tokens > 0 AND won = 1) - sumIf(-net_tokens, net_tokens < 0 AND won = 1) as total_pnl,

      (SELECT count() FROM pm_trader_events_v3 WHERE lower(trader_wallet) = '${wallet}') as trade_count

    FROM with_res
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = (await result.json() as any[])[0] || {};

  return {
    rawPhantom: Number(data.raw_phantom) || 0,
    fixedPhantom: Number(data.fixed_phantom) || 0,
    pairedTrades: Number(data.paired_trades) || 0,
    clobCashFlow: Number(data.clob_cash_flow) || 0,
    longWins: Number(data.long_wins) || 0,
    shortLosses: Number(data.short_losses) || 0,
    totalPnl: Number(data.total_pnl) || 0,
    tradeCount: Number(data.trade_count) || 0,
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log('PnL Engine V51 - PAIRED TRADE FIX');
  console.log('='.repeat(80));
  console.log('');
  console.log('Fix: Detect atomic mint-sell operations in same transaction');
  console.log('     Net out paired trades before calculating positions');
  console.log('');
  console.log('Testing on 10 previously-gated wallets from V50 pilot');
  console.log('');

  const results: any[] = [];

  for (let i = 0; i < TEST_WALLETS.length; i++) {
    const wallet = TEST_WALLETS[i];
    console.log(`[${i + 1}/${TEST_WALLETS.length}] ${wallet.slice(0, 14)}...`);

    try {
      const pnl = await calculatePnLWithPairedFix(wallet);
      const apiPnl = await getApiPnL(wallet);
      const error = pnl.totalPnl - apiPnl;
      const absError = Math.abs(error);

      // Determine status
      let status: string;
      if (pnl.fixedPhantom > 0) {
        status = 'STILL_GATED';
      } else if (absError <= 10) {
        status = 'PASS';
      } else if (absError <= 100) {
        status = 'CLOSE';
      } else {
        status = 'FAIL';
      }

      const phantomChange = pnl.rawPhantom - pnl.fixedPhantom;

      console.log(`  Phantom: ${pnl.rawPhantom} → ${pnl.fixedPhantom} (${phantomChange > 0 ? '-' : ''}${Math.abs(phantomChange)} fixed by pairing)`);
      console.log(`  Paired trades detected: ${pnl.pairedTrades}`);
      console.log(`  Calc: $${pnl.totalPnl.toFixed(2)} | API: $${apiPnl.toFixed(2)} | Err: $${error.toFixed(2)} | ${status}`);
      console.log('');

      results.push({
        wallet,
        rawPhantom: pnl.rawPhantom,
        fixedPhantom: pnl.fixedPhantom,
        phantomFixed: phantomChange,
        pairedTrades: pnl.pairedTrades,
        calcPnl: pnl.totalPnl,
        apiPnl,
        error,
        absError,
        status,
      });
    } catch (err) {
      console.log(`  ERROR: ${err}`);
      console.log('');
    }

    await new Promise(r => setTimeout(r, 500));
  }

  // Summary
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const totalRawPhantom = results.reduce((s, r) => s + r.rawPhantom, 0);
  const totalFixedPhantom = results.reduce((s, r) => s + r.fixedPhantom, 0);
  const totalPaired = results.reduce((s, r) => s + r.pairedTrades, 0);

  console.log(`\nPhantom positions:`);
  console.log(`  Before fix: ${totalRawPhantom}`);
  console.log(`  After fix:  ${totalFixedPhantom}`);
  console.log(`  Reduction:  ${totalRawPhantom - totalFixedPhantom} (${(100 * (totalRawPhantom - totalFixedPhantom) / totalRawPhantom).toFixed(1)}%)`);
  console.log(`  Paired trades detected: ${totalPaired}`);

  const passed = results.filter(r => r.status === 'PASS').length;
  const close = results.filter(r => r.status === 'CLOSE').length;
  const stillGated = results.filter(r => r.status === 'STILL_GATED').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  console.log(`\nResults:`);
  console.log(`  PASS (within $10): ${passed}`);
  console.log(`  CLOSE (within $100): ${close}`);
  console.log(`  STILL_GATED: ${stillGated}`);
  console.log(`  FAIL: ${failed}`);

  const ungated = results.filter(r => r.fixedPhantom === 0);
  if (ungated.length > 0) {
    const ungatedPassed = ungated.filter(r => r.absError <= 10).length;
    console.log(`\nUngated accuracy: ${ungatedPassed}/${ungated.length} (${(100 * ungatedPassed / ungated.length).toFixed(1)}%)`);
  }

  // Show individual results
  console.log(`\nDetailed results:`);
  console.log('-'.repeat(80));
  for (const r of results) {
    const errStr = r.error >= 0 ? `+$${r.error.toFixed(2)}` : `-$${Math.abs(r.error).toFixed(2)}`;
    console.log(`${r.wallet.slice(0, 14)}... | Ph: ${r.rawPhantom}→${r.fixedPhantom} | Paired: ${r.pairedTrades} | ${errStr.padStart(10)} | ${r.status}`);
  }

  // Save results
  const fs = await import('fs');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(`scripts/pilot-results-v51-${timestamp}.json`, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to scripts/pilot-results-v51-*.json`);
}

main().catch(console.error);
