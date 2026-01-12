/**
 * CLOSED-ONLY Overnight Pilot - PnL Engine V47
 *
 * Following GPT's advice:
 * 1. Target wallets with ALL resolved positions (no MTM needed)
 * 2. Union CLOB + CTF split/merge + CTF redemptions
 * 3. Exclude NegRisk wallets
 * 4. Exclude wallets with ERC1155 transfers (can't map yet)
 * 5. NO self-fill collapse (avoid over-destruction)
 *
 * This isolates "ledger completeness" from "MTM accuracy"
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

interface WalletResult {
  wallet: string;
  trades: number;
  positions: number;
  openPositions: number;
  clobCashFlow: number;
  ctfCashFlow: number;
  redemptionValue: number;
  longWins: number;
  shortLosses: number;
  totalCalcPnl: number;
  apiPnl: number;
  error: number;
  absError: number;
  status: 'pass' | 'fail' | 'gated';
  gateReason?: string;
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

async function selectClosedOnlyWallets(count: number): Promise<string[]> {
  // Select wallets that:
  // 1. Have 20-200 trades (medium activity)
  // 2. Have NO open positions (all conditions resolved)
  // 3. No NegRisk activity
  // 4. No ERC1155 transfers (we can't map them yet)
  const query = `
    WITH
      -- Wallets with medium activity
      active_wallets AS (
        SELECT lower(trader_wallet) as wallet, count() as trades
        FROM pm_trader_events_v3
        WHERE trade_time >= now() - INTERVAL 90 DAY
        GROUP BY trader_wallet
        HAVING trades BETWEEN 20 AND 200
      ),

      -- Wallets with NegRisk (exclude)
      negrisk_wallets AS (
        SELECT DISTINCT lower(user_address) as wallet
        FROM pm_neg_risk_conversions_v1
        WHERE is_deleted = 0
      ),

      -- Wallets with ERC1155 transfers (exclude - can't map)
      erc1155_wallets AS (
        SELECT DISTINCT lower(to_address) as wallet FROM pm_erc1155_transfers WHERE is_deleted = 0
        UNION DISTINCT
        SELECT DISTINCT lower(from_address) as wallet FROM pm_erc1155_transfers WHERE is_deleted = 0
      ),

      -- Check which wallets have open positions
      wallet_positions AS (
        SELECT
          lower(trader_wallet) as wallet,
          m.condition_id,
          m.outcome_index,
          sumIf(token_amount / 1e6, side = 'buy') - sumIf(token_amount / 1e6, side = 'sell') as net_tokens
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) IN (SELECT wallet FROM active_wallets)
          AND m.condition_id != ''
        GROUP BY trader_wallet, m.condition_id, m.outcome_index
      ),

      with_resolution AS (
        SELECT
          wp.wallet,
          wp.condition_id,
          wp.net_tokens,
          r.payout_numerators,
          r.condition_id IS NULL OR r.payout_numerators = '' as is_open
        FROM wallet_positions wp
        LEFT JOIN pm_condition_resolutions r ON wp.condition_id = r.condition_id AND r.is_deleted = 0
        WHERE abs(wp.net_tokens) > 0.01
      ),

      -- Wallets with ANY open position (exclude)
      open_position_wallets AS (
        SELECT DISTINCT wallet
        FROM with_resolution
        WHERE is_open = 1
      )

    -- Final selection: active, no negrisk, no erc1155, no open positions
    SELECT aw.wallet, aw.trades
    FROM active_wallets aw
    WHERE aw.wallet NOT IN (SELECT wallet FROM negrisk_wallets)
      AND aw.wallet NOT IN (SELECT wallet FROM erc1155_wallets)
      AND aw.wallet NOT IN (SELECT wallet FROM open_position_wallets)
    ORDER BY rand()
    LIMIT ${count}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  return rows.map(r => r.wallet);
}

async function calculateWalletPnL(wallet: string): Promise<{
  clobCashFlow: number;
  ctfCashFlow: number;
  redemptionValue: number;
  longWins: number;
  shortLosses: number;
  totalPnl: number;
  tradeCount: number;
  positionCount: number;
  openPositionCount: number;
}> {
  // Full ledger: CLOB + CTF split/merge + CTF redemptions
  // NO self-fill collapse (per GPT advice - avoid over-destruction)
  const query = `
    WITH
      -- CLOB trades (no self-fill collapse for now)
      clob_trades AS (
        SELECT
          m.condition_id,
          m.outcome_index,
          sumIf(t.token_amount / 1e6, t.side = 'buy') as bought_clob,
          sumIf(t.token_amount / 1e6, t.side = 'sell') as sold_clob,
          sumIf(t.usdc_amount / 1e6, t.side = 'sell') - sumIf(t.usdc_amount / 1e6, t.side = 'buy') as cash_flow_clob
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${wallet}'
          AND m.condition_id != ''
        GROUP BY m.condition_id, m.outcome_index
      ),

      -- CTF splits/merges
      ctf_flows AS (
        SELECT
          condition_id,
          outcome_index,
          sum(shares_delta) as shares_from_ctf,
          sum(cash_delta) as cash_from_ctf
        FROM pm_ctf_split_merge_expanded
        WHERE lower(wallet) = '${wallet}'
        GROUP BY condition_id, outcome_index
      ),

      -- CTF redemptions
      redemptions AS (
        SELECT
          lower(CASE WHEN startsWith(condition_id, '0x') THEN substring(condition_id, 3) ELSE condition_id END) as condition_id,
          arrayJoin([0, 1]) as outcome_index,
          toFloat64(amount_or_payout) / 1e6 as redeemed_value
        FROM pm_ctf_events
        WHERE lower(user_address) = '${wallet}'
          AND event_type = 'PayoutRedemption'
      ),

      redemption_by_position AS (
        SELECT condition_id, outcome_index, sum(redeemed_value) as redemption_value
        FROM redemptions
        GROUP BY condition_id, outcome_index
      ),

      -- Combine all sources
      combined AS (
        SELECT
          COALESCE(c.condition_id, f.condition_id, r.condition_id) as condition_id,
          COALESCE(c.outcome_index, f.outcome_index, r.outcome_index) as outcome_index,
          COALESCE(c.bought_clob, 0) as bought_clob,
          COALESCE(c.sold_clob, 0) as sold_clob,
          COALESCE(c.cash_flow_clob, 0) as cash_clob,
          COALESCE(f.shares_from_ctf, 0) as tokens_ctf,
          COALESCE(f.cash_from_ctf, 0) as cash_ctf,
          COALESCE(r.redemption_value, 0) as redemption_value,
          -- Net tokens from all sources
          COALESCE(c.bought_clob, 0) - COALESCE(c.sold_clob, 0) + COALESCE(f.shares_from_ctf, 0) as net_tokens
        FROM clob_trades c
        FULL OUTER JOIN ctf_flows f ON c.condition_id = f.condition_id AND c.outcome_index = f.outcome_index
        FULL OUTER JOIN redemption_by_position r ON COALESCE(c.condition_id, f.condition_id) = r.condition_id
          AND COALESCE(c.outcome_index, f.outcome_index) = r.outcome_index
      ),

      -- Join resolutions
      with_res AS (
        SELECT
          cb.*,
          r.payout_numerators,
          toInt64OrNull(JSONExtractString(r.payout_numerators, cb.outcome_index + 1)) = 1 as won,
          r.condition_id IS NULL OR r.payout_numerators = '' as is_open
        FROM combined cb
        LEFT JOIN pm_condition_resolutions r ON cb.condition_id = r.condition_id AND r.is_deleted = 0
      )

    SELECT
      sum(cash_clob) as clob_cash_flow,
      sum(cash_ctf) as ctf_cash_flow,
      sum(redemption_value) as redemption_value,
      sumIf(net_tokens, net_tokens > 0 AND won = 1) as long_wins,
      sumIf(-net_tokens, net_tokens < 0 AND won = 1) as short_losses,
      -- Total PnL: cash flows + wins - losses + redemptions
      sum(cash_clob) + sum(cash_ctf) +
        sumIf(net_tokens, net_tokens > 0 AND won = 1) -
        sumIf(-net_tokens, net_tokens < 0 AND won = 1) +
        sum(redemption_value) as total_pnl,
      (SELECT count() FROM pm_trader_events_v3 WHERE lower(trader_wallet) = '${wallet}') as trade_count,
      count() as position_count,
      countIf(abs(net_tokens) > 0.01 AND is_open = 1) as open_positions
    FROM with_res
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = (await result.json() as any[])[0] || {};

  return {
    clobCashFlow: Number(data.clob_cash_flow) || 0,
    ctfCashFlow: Number(data.ctf_cash_flow) || 0,
    redemptionValue: Number(data.redemption_value) || 0,
    longWins: Number(data.long_wins) || 0,
    shortLosses: Number(data.short_losses) || 0,
    totalPnl: Number(data.total_pnl) || 0,
    tradeCount: Number(data.trade_count) || 0,
    positionCount: Number(data.position_count) || 0,
    openPositionCount: Number(data.open_positions) || 0,
  };
}

async function runPilot() {
  const startTime = Date.now();
  console.log('='.repeat(80));
  console.log('CLOSED-ONLY Overnight Pilot - PnL Engine V47');
  console.log('='.repeat(80));
  console.log('');
  console.log('Methodology:');
  console.log('  - Target: Wallets with ALL positions resolved (no MTM needed)');
  console.log('  - Ledger: CLOB + CTF split/merge + CTF redemptions');
  console.log('  - Gates: Exclude NegRisk, ERC1155 transfers, open positions');
  console.log('  - Self-fill: NO collapse (avoid over-destruction)');
  console.log('');
  console.log('This isolates "ledger completeness" from "MTM accuracy"');
  console.log('');

  // Select closed-only wallets
  console.log('Selecting 50 closed-only wallets...');
  const wallets = await selectClosedOnlyWallets(50);
  console.log(`Found ${wallets.length} qualifying wallets\n`);

  if (wallets.length === 0) {
    console.log('ERROR: No qualifying wallets found!');
    console.log('Try relaxing the criteria (fewer trades, longer timeframe)');
    return;
  }

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
      let gateReason: string | undefined;

      if (pnl.openPositionCount > 0) {
        status = 'gated';
        gateReason = 'unexpected_open_positions';
      } else if (absError <= 10) {
        status = 'pass';
      } else if (absError <= 100) {
        status = 'fail';  // Close but not passing
      } else {
        status = 'fail';
      }

      results.push({
        wallet,
        trades: pnl.tradeCount,
        positions: pnl.positionCount,
        openPositions: pnl.openPositionCount,
        clobCashFlow: pnl.clobCashFlow,
        ctfCashFlow: pnl.ctfCashFlow,
        redemptionValue: pnl.redemptionValue,
        longWins: pnl.longWins,
        shortLosses: pnl.shortLosses,
        totalCalcPnl: pnl.totalPnl,
        apiPnl,
        error,
        absError,
        status,
        gateReason,
      });

      const statusStr = status.toUpperCase().padEnd(6);
      const errStr = error >= 0 ? `+${error.toFixed(2)}` : error.toFixed(2);
      console.log(
        `${statusStr} | Calc: ${pnl.totalPnl.toFixed(2).padStart(12)} | ` +
        `API: ${apiPnl.toFixed(2).padStart(12)} | ` +
        `Err: ${errStr.padStart(12)} | ` +
        `CTF: ${pnl.ctfCashFlow.toFixed(0)} | Red: ${pnl.redemptionValue.toFixed(0)}`
      );
    } catch (err) {
      console.log(`ERROR: ${err}`);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 300));
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(80));
  console.log(`SUMMARY (completed in ${elapsed}s)`);
  console.log('='.repeat(80));

  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const gated = results.filter(r => r.status === 'gated').length;

  const ungated = results.filter(r => r.status !== 'gated');
  const within10 = ungated.filter(r => r.absError <= 10).length;
  const within100 = ungated.filter(r => r.absError <= 100).length;
  const within1000 = ungated.filter(r => r.absError <= 1000).length;

  console.log(`\nTotal wallets tested: ${results.length}`);
  console.log(`  Passed (within $10): ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Gated (unexpected open): ${gated}`);

  if (ungated.length > 0) {
    console.log(`\nUngated wallets: ${ungated.length}`);
    console.log(`  Within $10:   ${within10}/${ungated.length} (${(100 * within10 / ungated.length).toFixed(1)}%)`);
    console.log(`  Within $100:  ${within100}/${ungated.length} (${(100 * within100 / ungated.length).toFixed(1)}%)`);
    console.log(`  Within $1000: ${within1000}/${ungated.length} (${(100 * within1000 / ungated.length).toFixed(1)}%)`);

    // Error distribution
    const errors = ungated.map(r => r.absError).sort((a, b) => a - b);
    const p50 = errors[Math.floor(errors.length * 0.5)];
    const p90 = errors[Math.floor(errors.length * 0.9)];
    console.log(`\nError distribution (ungated):`);
    console.log(`  Min:    $${errors[0]?.toFixed(2)}`);
    console.log(`  Median: $${p50?.toFixed(2)}`);
    console.log(`  P90:    $${p90?.toFixed(2)}`);
    console.log(`  Max:    $${errors[errors.length - 1]?.toFixed(2)}`);

    // Check CTF/redemption contribution
    const withCtf = ungated.filter(r => Math.abs(r.ctfCashFlow) > 0.01);
    const withRedemption = ungated.filter(r => Math.abs(r.redemptionValue) > 0.01);
    console.log(`\nCTF/Redemption usage:`);
    console.log(`  Wallets with CTF splits/merges: ${withCtf.length}/${ungated.length}`);
    console.log(`  Wallets with redemptions: ${withRedemption.length}/${ungated.length}`);
  }

  // Show worst failures
  const failures = results.filter(r => r.status === 'fail');
  if (failures.length > 0) {
    console.log('\nWorst failures (investigate):');
    for (const f of failures.sort((a, b) => b.absError - a.absError).slice(0, 10)) {
      console.log(`  ${f.wallet.slice(0, 12)}... err=$${f.error.toFixed(2)}, trades=${f.trades}, CTF=${f.ctfCashFlow.toFixed(0)}`);
    }
  }

  // Pass/fail determination
  console.log('\n' + '='.repeat(80));
  if (ungated.length >= 20 && within10 / ungated.length >= 0.9) {
    console.log('PILOT PASSED - Ledger is complete enough for production');
    console.log('Next: Proceed to full backfill');
  } else if (ungated.length >= 20 && within100 / ungated.length >= 0.9) {
    console.log('PILOT PARTIAL PASS - 90%+ within $100');
    console.log('Likely: Minor CTF mapping issues or rounding');
  } else if (ungated.length < 20) {
    console.log('PILOT INCONCLUSIVE - Not enough qualifying wallets');
    console.log(`Only ${ungated.length} closed-only wallets found (need 20+)`);
    console.log('Try: Relax activity criteria or longer timeframe');
  } else {
    console.log('PILOT NEEDS WORK - Ledger incomplete');
    const passRate = (100 * within10 / ungated.length).toFixed(1);
    console.log(`Within $10: ${passRate}%`);
    console.log('Investigate: Missing token flows (CTF, ERC1155, NegRisk)');
  }
  console.log('='.repeat(80));

  // Save results
  const fs = await import('fs');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsPath = `/Users/scotty/Projects/Cascadian-app/scripts/pilot-results-closed-${timestamp}.json`;
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to: ${resultsPath}`);
}

runPilot().catch(console.error);
