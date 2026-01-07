/**
 * V6 LEDGER RECONCILIATION SCRIPT
 *
 * Compares our TX-level maker-preferred dedupe output against
 * pm_unified_ledger_v6 (canonical ground truth) per condition/outcome.
 *
 * This validates:
 * 1. If our dedupe logic matches the canonical ledger
 * 2. Where discrepancies exist (missing flows, wrong dedupe, etc.)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = process.argv[2] || '0xf918977ef9d3f101385eda508621d5f835fa9052';

interface Position {
  condition_id: string;
  outcome_index: number;
  cash_flow: number;
  final_tokens: number;
}

interface RawTrade {
  event_id: string;
  token_id: string;
  side: 'buy' | 'sell';
  role: 'maker' | 'taker';
  usdc_raw: string;
  tokens_raw: string;
  trade_time: string;
  tx_hash: string;
  condition_id: string;
  outcome_index: number;
}

function txLevelMakerPreferred(trades: RawTrade[]): RawTrade[] {
  const txGroups = new Map<string, RawTrade[]>();
  for (const t of trades) {
    const arr = txGroups.get(t.tx_hash) || [];
    arr.push(t);
    txGroups.set(t.tx_hash, arr);
  }

  const out: RawTrade[] = [];
  for (const [txHash, txTrades] of txGroups) {
    const makers = txTrades.filter(t => t.role === 'maker');
    if (makers.length > 0) {
      out.push(...makers);
    } else {
      out.push(...txTrades);
    }
  }
  return out;
}

async function main() {
  console.log('V6 LEDGER RECONCILIATION\n');
  console.log(`Wallet: ${WALLET}`);
  console.log('='.repeat(80));

  // 1. Get V6 ledger positions (ground truth)
  const v6Query = `
    SELECT
      condition_id,
      outcome_index,
      sum(usdc_delta) as cash_flow,
      sum(token_delta) as final_tokens
    FROM pm_unified_ledger_v6
    WHERE lower(wallet_address) = lower('${WALLET}')
    GROUP BY condition_id, outcome_index
  `;

  const v6Result = await clickhouse.query({ query: v6Query, format: 'JSONEachRow' });
  const v6Rows = (await v6Result.json()) as any[];

  const v6Positions = new Map<string, Position>();
  for (const row of v6Rows) {
    const key = `${row.condition_id}|${row.outcome_index}`;
    v6Positions.set(key, {
      condition_id: row.condition_id,
      outcome_index: Number(row.outcome_index),
      cash_flow: Number(row.cash_flow),
      final_tokens: Number(row.final_tokens),
    });
  }

  console.log(`\nV6 Ledger: ${v6Positions.size} positions from ${new Set(v6Rows.map(r => r.condition_id)).size} conditions`);

  // 2. Get CLOB trades and apply TX-level maker-preferred
  const tradeQuery = `
    SELECT
      event_id,
      token_id,
      side,
      role,
      toString(usdc_amount) as usdc_raw,
      toString(token_amount) as tokens_raw,
      trade_time,
      lower(concat('0x', hex(transaction_hash))) as tx_hash,
      m.condition_id,
      m.outcome_index
    FROM pm_trader_events_v2 t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(trader_wallet) = lower('${WALLET}')
      AND is_deleted = 0
      AND m.condition_id IS NOT NULL
    ORDER BY trade_time, event_id
  `;

  const tradeResult = await clickhouse.query({ query: tradeQuery, format: 'JSONEachRow' });
  const allTrades = (await tradeResult.json()) as RawTrade[];

  console.log(`CLOB Trades: ${allTrades.length} total`);

  const dedupedTrades = txLevelMakerPreferred(allTrades);
  console.log(`After TX-level dedupe: ${dedupedTrades.length} trades`);

  // Build our positions
  const ourPositions = new Map<string, Position>();
  for (const t of dedupedTrades) {
    const key = `${t.condition_id}|${t.outcome_index}`;
    const pos = ourPositions.get(key) || {
      condition_id: t.condition_id,
      outcome_index: t.outcome_index,
      cash_flow: 0,
      final_tokens: 0,
    };

    const usdc = Number(t.usdc_raw) / 1e6;
    const tokens = Number(t.tokens_raw) / 1e6;

    if (t.side === 'sell') {
      pos.cash_flow += usdc;
      pos.final_tokens -= tokens;
    } else {
      pos.cash_flow -= usdc;
      pos.final_tokens += tokens;
    }

    ourPositions.set(key, pos);
  }

  console.log(`Our positions: ${ourPositions.size}`);

  // 3. Compare position by position
  console.log('\n\nPOSITION COMPARISON:');
  console.log('Condition (last 12) | Outcome | V6 Cash | Our Cash | Δ Cash | V6 Tokens | Our Tokens | Δ Tokens | Match');
  console.log('-'.repeat(110));

  let matches = 0;
  let mismatches = 0;
  let inV6Only = 0;
  let inOursOnly = 0;

  // All condition/outcome keys from both
  const allKeys = new Set([...v6Positions.keys(), ...ourPositions.keys()]);

  interface Discrepancy {
    key: string;
    type: 'V6_ONLY' | 'OURS_ONLY' | 'MISMATCH';
    v6?: Position;
    ours?: Position;
    cashDelta?: number;
    tokensDelta?: number;
  }
  const discrepancies: Discrepancy[] = [];

  for (const key of [...allKeys].sort()) {
    const v6 = v6Positions.get(key);
    const ours = ourPositions.get(key);

    if (v6 && ours) {
      const cashDelta = Math.abs(v6.cash_flow - ours.cash_flow);
      const tokensDelta = Math.abs(v6.final_tokens - ours.final_tokens);
      const isMatch = cashDelta < 0.01 && tokensDelta < 0.01;

      if (isMatch) {
        matches++;
      } else {
        mismatches++;
        discrepancies.push({
          key,
          type: 'MISMATCH',
          v6,
          ours,
          cashDelta,
          tokensDelta,
        });
      }

      const matchSymbol = isMatch ? '✓' : '✗';
      console.log(
        `...${v6.condition_id.slice(-12)} | ${v6.outcome_index.toString().padStart(7)} | ` +
        `${v6.cash_flow.toFixed(2).padStart(8)} | ${ours.cash_flow.toFixed(2).padStart(8)} | ` +
        `${cashDelta.toFixed(2).padStart(6)} | ` +
        `${v6.final_tokens.toFixed(2).padStart(9)} | ${ours.final_tokens.toFixed(2).padStart(10)} | ` +
        `${tokensDelta.toFixed(2).padStart(8)} | ${matchSymbol}`
      );
    } else if (v6 && !ours) {
      inV6Only++;
      discrepancies.push({ key, type: 'V6_ONLY', v6 });
      console.log(
        `...${v6.condition_id.slice(-12)} | ${v6.outcome_index.toString().padStart(7)} | ` +
        `${v6.cash_flow.toFixed(2).padStart(8)} |      --- |    --- | ` +
        `${v6.final_tokens.toFixed(2).padStart(9)} |        --- |      --- | V6 ONLY`
      );
    } else if (!v6 && ours) {
      inOursOnly++;
      discrepancies.push({ key, type: 'OURS_ONLY', ours });
      console.log(
        `...${ours.condition_id.slice(-12)} | ${ours.outcome_index.toString().padStart(7)} | ` +
        `     --- | ${ours.cash_flow.toFixed(2).padStart(8)} |    --- | ` +
        `      --- | ${ours.final_tokens.toFixed(2).padStart(10)} |      --- | OURS ONLY`
      );
    }
  }

  console.log('-'.repeat(110));

  // 4. Summary
  console.log('\n\nSUMMARY:');
  console.log(`  Matching positions: ${matches}`);
  console.log(`  Mismatches: ${mismatches}`);
  console.log(`  In V6 only: ${inV6Only}`);
  console.log(`  In ours only: ${inOursOnly}`);

  const matchRate = matches / allKeys.size * 100;
  console.log(`\n  Match rate: ${matchRate.toFixed(1)}%`);

  if (discrepancies.length > 0) {
    console.log('\n\nTOP DISCREPANCIES:');
    const sorted = discrepancies
      .filter(d => d.type === 'MISMATCH')
      .sort((a, b) => (b.cashDelta! + b.tokensDelta!) - (a.cashDelta! + a.tokensDelta!))
      .slice(0, 5);

    for (const d of sorted) {
      console.log(`  ${d.key}: Δ cash=${d.cashDelta?.toFixed(2)}, Δ tokens=${d.tokensDelta?.toFixed(2)}`);
    }
  }

  // 5. Calculate PnL from V6
  console.log('\n\nV6 PNL CALCULATION:');

  const conditionIds = [...new Set([...v6Positions.values()].map(p => p.condition_id))];
  const condList = conditionIds.map(c => `'${c.toLowerCase()}'`).join(',');

  const resQuery = `
    SELECT lower(condition_id) as condition_id, payout_numerators
    FROM pm_condition_resolutions
    WHERE lower(condition_id) IN (${condList || "''"})
  `;

  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resRows = (await resResult.json()) as any[];

  const resolutions = new Map<string, number[]>();
  for (const row of resRows) {
    if (row.payout_numerators) {
      try {
        const payouts = JSON.parse(row.payout_numerators.replace(/'/g, '"'));
        resolutions.set(row.condition_id, payouts);
      } catch { }
    }
  }

  let v6TotalPnl = 0;
  let ourTotalPnl = 0;

  for (const [key, pos] of v6Positions) {
    const payouts = resolutions.get(pos.condition_id.toLowerCase());
    if (!payouts) continue;
    const denom = payouts.reduce((a, b) => a + b, 0);
    const payout = denom > 0 ? payouts[pos.outcome_index] / denom : 0.5;
    v6TotalPnl += pos.cash_flow + (pos.final_tokens * payout);
  }

  for (const [key, pos] of ourPositions) {
    const payouts = resolutions.get(pos.condition_id.toLowerCase());
    if (!payouts) continue;
    const denom = payouts.reduce((a, b) => a + b, 0);
    const payout = denom > 0 ? payouts[pos.outcome_index] / denom : 0.5;
    ourTotalPnl += pos.cash_flow + (pos.final_tokens * payout);
  }

  console.log(`  V6 Total PnL: $${v6TotalPnl.toFixed(2)}`);
  console.log(`  Our Total PnL: $${ourTotalPnl.toFixed(2)}`);
  console.log(`  Difference: $${(ourTotalPnl - v6TotalPnl).toFixed(2)} (${((ourTotalPnl - v6TotalPnl) / v6TotalPnl * 100).toFixed(1)}%)`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
