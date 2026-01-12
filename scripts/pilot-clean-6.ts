/**
 * PnL Pilot V50 - CLOB + CTF + ERC1155 + MTM
 *
 * Full ledger:
 * - CLOB trades
 * - CTF splits/merges
 * - ERC1155 P2P transfers
 * - Mark-to-Market for open positions
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

// Dynamic wallet selection - will select random wallets at runtime
const WALLET_COUNT = 50;

async function selectRandomWallets(count: number): Promise<string[]> {
  const query = `
    SELECT DISTINCT lower(trader_wallet) as wallet
    FROM pm_trader_events_v3
    WHERE trade_time >= now() - INTERVAL 60 DAY
    GROUP BY trader_wallet
    HAVING count() BETWEEN 20 AND 300
    ORDER BY rand()
    LIMIT ${count}
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  return rows.map(r => r.wallet);
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
  } catch {}
  return 0;
}

async function checkGates(wallet: string): Promise<{
  hasNegRisk: boolean;
  phantomPositions: number;
  openPositions: number;
}> {
  // Now we include ERC1155, so only gate on NegRisk and remaining phantoms
  const query = `
    WITH
      negrisk AS (
        SELECT count() as cnt FROM pm_neg_risk_conversions_v1
        WHERE lower(user_address) = '${wallet}' AND is_deleted = 0
      ),
      -- CLOB positions
      clob_pos AS (
        SELECT m.condition_id, m.outcome_index,
          sumIf(t.token_amount / 1e6, t.side = 'buy') as bought,
          sumIf(t.token_amount / 1e6, t.side = 'sell') as sold
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${wallet}' AND m.condition_id != ''
        GROUP BY m.condition_id, m.outcome_index
      ),
      -- CTF positions
      ctf_pos AS (
        SELECT condition_id, outcome_index, sum(shares_delta) as ctf_tokens
        FROM pm_ctf_split_merge_expanded
        WHERE lower(wallet) = '${wallet}'
        GROUP BY condition_id, outcome_index
      ),
      -- ERC1155 P2P transfers (incoming = positive, outgoing = negative)
      erc1155_pos AS (
        SELECT
          m.condition_id,
          m.outcome_index,
          sum(CASE
            WHEN lower(e.to_address) = '${wallet}' THEN reinterpretAsUInt256(reverse(unhex(substring(e.value, 3)))) / 1e6
            WHEN lower(e.from_address) = '${wallet}' THEN -reinterpretAsUInt256(reverse(unhex(substring(e.value, 3)))) / 1e6
            ELSE 0
          END) as erc_tokens
        FROM pm_erc1155_transfers e
        JOIN pm_token_to_condition_map_v5 m
          ON toString(reinterpretAsUInt256(reverse(unhex(substring(e.token_id, 3))))) = m.token_id_dec
        WHERE (lower(e.to_address) = '${wallet}' OR lower(e.from_address) = '${wallet}')
          AND e.is_deleted = 0
          AND m.condition_id != ''
        GROUP BY m.condition_id, m.outcome_index
      ),
      -- Combine all sources
      combined AS (
        SELECT
          COALESCE(c.condition_id, f.condition_id, e.condition_id) as condition_id,
          COALESCE(c.outcome_index, f.outcome_index, e.outcome_index) as outcome_index,
          COALESCE(c.bought, 0) + COALESCE(f.ctf_tokens, 0) + greatest(COALESCE(e.erc_tokens, 0), 0) as total_in,
          COALESCE(c.sold, 0) + abs(least(COALESCE(e.erc_tokens, 0), 0)) as total_out
        FROM clob_pos c
        FULL OUTER JOIN ctf_pos f ON c.condition_id = f.condition_id AND c.outcome_index = f.outcome_index
        FULL OUTER JOIN erc1155_pos e ON COALESCE(c.condition_id, f.condition_id) = e.condition_id
          AND COALESCE(c.outcome_index, f.outcome_index) = e.outcome_index
      ),
      with_res AS (
        SELECT cb.*,
          r.payout_numerators,
          r.condition_id IS NULL OR r.payout_numerators = '' as is_open
        FROM combined cb
        LEFT JOIN pm_condition_resolutions r ON cb.condition_id = r.condition_id AND r.is_deleted = 0
      )
    SELECT
      (SELECT cnt FROM negrisk) as has_negrisk,
      countIf(total_out > total_in * 1.01) as phantom_positions,
      countIf(abs(total_in - total_out) > 0.01 AND is_open = 1) as open_positions
    FROM with_res
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = (await result.json() as any[])[0] || {};

  return {
    hasNegRisk: Number(data.has_negrisk) > 0,
    phantomPositions: Number(data.phantom_positions) || 0,
    openPositions: Number(data.open_positions) || 0,
  };
}

async function calculatePnL(wallet: string): Promise<{
  clobCashFlow: number;
  ctfCashFlow: number;
  ercTokensDelta: number;
  longWins: number;
  shortLosses: number;
  unrealizedMtm: number;
  totalPnl: number;
  tradeCount: number;
}> {
  // PnL formula with full ledger:
  // Total PnL = CLOB_cash + CTF_cash + Long_wins - Short_losses + Unrealized_MTM
  // Net tokens = CLOB buys - CLOB sells + CTF shares + ERC1155 net
  const query = `
    WITH
      -- CLOB trades
      clob_trades AS (
        SELECT m.condition_id, m.outcome_index,
          sumIf(t.token_amount / 1e6, t.side = 'buy') as bought_clob,
          sumIf(t.token_amount / 1e6, t.side = 'sell') as sold_clob,
          sumIf(t.usdc_amount / 1e6, t.side = 'sell') - sumIf(t.usdc_amount / 1e6, t.side = 'buy') as cash_flow_clob
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${wallet}' AND m.condition_id != ''
        GROUP BY m.condition_id, m.outcome_index
      ),
      -- CTF splits/merges
      ctf_flows AS (
        SELECT condition_id, outcome_index,
          sum(shares_delta) as shares_from_ctf,
          sum(cash_delta) as cash_from_ctf
        FROM pm_ctf_split_merge_expanded
        WHERE lower(wallet) = '${wallet}'
        GROUP BY condition_id, outcome_index
      ),
      -- ERC1155 P2P transfers
      erc1155_flows AS (
        SELECT
          m.condition_id,
          m.outcome_index,
          sum(CASE
            WHEN lower(e.to_address) = '${wallet}' THEN reinterpretAsUInt256(reverse(unhex(substring(e.value, 3)))) / 1e6
            WHEN lower(e.from_address) = '${wallet}' THEN -reinterpretAsUInt256(reverse(unhex(substring(e.value, 3)))) / 1e6
            ELSE 0
          END) as tokens_from_erc
        FROM pm_erc1155_transfers e
        JOIN pm_token_to_condition_map_v5 m
          ON toString(reinterpretAsUInt256(reverse(unhex(substring(e.token_id, 3))))) = m.token_id_dec
        WHERE (lower(e.to_address) = '${wallet}' OR lower(e.from_address) = '${wallet}')
          AND e.is_deleted = 0
          AND m.condition_id != ''
        GROUP BY m.condition_id, m.outcome_index
      ),
      -- Combine all sources
      combined AS (
        SELECT
          COALESCE(c.condition_id, f.condition_id, e.condition_id) as condition_id,
          COALESCE(c.outcome_index, f.outcome_index, e.outcome_index) as outcome_index,
          COALESCE(c.cash_flow_clob, 0) as cash_clob,
          COALESCE(f.cash_from_ctf, 0) as cash_ctf,
          COALESCE(e.tokens_from_erc, 0) as tokens_erc,
          COALESCE(c.bought_clob, 0) - COALESCE(c.sold_clob, 0)
            + COALESCE(f.shares_from_ctf, 0)
            + COALESCE(e.tokens_from_erc, 0) as net_tokens
        FROM clob_trades c
        FULL OUTER JOIN ctf_flows f ON c.condition_id = f.condition_id AND c.outcome_index = f.outcome_index
        FULL OUTER JOIN erc1155_flows e ON COALESCE(c.condition_id, f.condition_id) = e.condition_id
          AND COALESCE(c.outcome_index, f.outcome_index) = e.outcome_index
      ),
      with_res AS (
        SELECT cb.*,
          r.payout_numerators,
          r.condition_id IS NULL OR r.payout_numerators = '' as is_open,
          toInt64OrNull(JSONExtractString(r.payout_numerators, cb.outcome_index + 1)) = 1 as won
        FROM combined cb
        LEFT JOIN pm_condition_resolutions r ON cb.condition_id = r.condition_id AND r.is_deleted = 0
      ),
      with_prices AS (
        SELECT wr.*,
          p.mark_price
        FROM with_res wr
        LEFT JOIN pm_latest_mark_price_v1 p
          ON wr.condition_id = p.condition_id AND wr.outcome_index = p.outcome_index
      )
    SELECT
      sum(cash_clob) as clob_cash_flow,
      sum(cash_ctf) as ctf_cash_flow,
      sum(tokens_erc) as erc_tokens_delta,
      sumIf(net_tokens, net_tokens > 0 AND won = 1) as long_wins,
      sumIf(-net_tokens, net_tokens < 0 AND won = 1) as short_losses,
      -- MTM: value open positions at current mark price
      sumIf(net_tokens * COALESCE(mark_price, 0.5), is_open = 1 AND abs(net_tokens) > 0.01) as unrealized_mtm,
      -- Total PnL = realized + unrealized
      sum(cash_clob) + sum(cash_ctf)
        + sumIf(net_tokens, net_tokens > 0 AND won = 1)
        - sumIf(-net_tokens, net_tokens < 0 AND won = 1)
        + sumIf(net_tokens * COALESCE(mark_price, 0.5), is_open = 1 AND abs(net_tokens) > 0.01) as total_pnl,
      (SELECT count() FROM pm_trader_events_v3 WHERE lower(trader_wallet) = '${wallet}') as trade_count
    FROM with_prices
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = (await result.json() as any[])[0] || {};

  return {
    clobCashFlow: Number(data.clob_cash_flow) || 0,
    ctfCashFlow: Number(data.ctf_cash_flow) || 0,
    ercTokensDelta: Number(data.erc_tokens_delta) || 0,
    longWins: Number(data.long_wins) || 0,
    shortLosses: Number(data.short_losses) || 0,
    unrealizedMtm: Number(data.unrealized_mtm) || 0,
    totalPnl: Number(data.total_pnl) || 0,
    tradeCount: Number(data.trade_count) || 0,
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log(`PnL Pilot V50 - FULL LEDGER (${WALLET_COUNT} random wallets)`);
  console.log('='.repeat(80));
  console.log('');
  console.log('Formula: PnL = Cash_flow + Long_wins - Short_losses + Unrealized_MTM');
  console.log('Ledger:  CLOB + CTF split/merge + ERC1155 transfers + MTM');
  console.log('Gates:   NegRisk only (Phantom after all sources)');
  console.log('');

  console.log(`Selecting ${WALLET_COUNT} random wallets...`);
  const TEST_WALLETS = await selectRandomWallets(WALLET_COUNT);
  console.log(`Selected ${TEST_WALLETS.length} wallets\n`);

  const results: any[] = [];

  for (let i = 0; i < TEST_WALLETS.length; i++) {
    const wallet = TEST_WALLETS[i];
    console.log(`[${i + 1}/${TEST_WALLETS.length}] ${wallet.slice(0, 12)}...`);

    try {
      const gates = await checkGates(wallet);
      console.log(`  Gates: NR=${gates.hasNegRisk ? 'Y' : 'N'} Ph=${gates.phantomPositions} Open=${gates.openPositions}`);

      const pnl = await calculatePnL(wallet);
      const apiPnl = await getApiPnL(wallet);
      const error = pnl.totalPnl - apiPnl;

      let status = 'PASS';
      let gateReason = '';
      if (gates.hasNegRisk) { status = 'GATED'; gateReason = 'NegRisk'; }
      else if (gates.phantomPositions > 0) { status = 'GATED'; gateReason = `Phantom(${gates.phantomPositions})`; }
      else if (Math.abs(error) > 10) { status = 'FAIL'; }

      console.log(`  Calc: $${pnl.totalPnl.toFixed(2)} | API: $${apiPnl.toFixed(2)} | Err: $${error.toFixed(2)} | ${status} ${gateReason}`);
      console.log(`  Components: CLOB=${pnl.clobCashFlow.toFixed(2)} CTF=${pnl.ctfCashFlow.toFixed(2)} ERC=${pnl.ercTokensDelta.toFixed(2)} LW=${pnl.longWins.toFixed(2)} SL=${pnl.shortLosses.toFixed(2)} MTM=${pnl.unrealizedMtm.toFixed(2)}`);
      console.log('');

      results.push({
        wallet,
        ...gates,
        ...pnl,
        apiPnl,
        error,
        absError: Math.abs(error),
        status,
        gateReason,
      });
    } catch (err) {
      console.log(`  ERROR: ${err}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const gated = results.filter(r => r.status === 'GATED').length;

  console.log(`Total: ${results.length}`);
  console.log(`  Passed (within $10): ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Gated: ${gated}`);

  const ungated = results.filter(r => r.status !== 'GATED');
  if (ungated.length > 0) {
    const within10 = ungated.filter(r => r.absError <= 10).length;
    const within100 = ungated.filter(r => r.absError <= 100).length;
    console.log(`\nUngated accuracy:`);
    console.log(`  Within $10: ${within10}/${ungated.length} (${(100 * within10 / ungated.length).toFixed(1)}%)`);
    console.log(`  Within $100: ${within100}/${ungated.length} (${(100 * within100 / ungated.length).toFixed(1)}%)`);
  }

  const fs = await import('fs');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(`scripts/pilot-results-v50-${timestamp}.json`, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to scripts/pilot-results-v50-*.json`);
}

main().catch(console.error);
