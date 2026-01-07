/**
 * Compare V6 CLOB-only vs our TX-level maker-preferred
 *
 * This should show exact match if our dedupe is correct
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = process.argv[2] || '0x7ad55bf11a52eb0e46b0ee13f53ce52da3fd1d61';

interface Position {
  condition_id: string;
  outcome_index: number;
  cash_flow: number;
  final_tokens: number;
}

async function main() {
  console.log('COMPARING V6 CLOB-ONLY vs TX-LEVEL MAKER-PREFERRED\n');
  console.log(`Wallet: ${WALLET}`);
  console.log('='.repeat(80));

  // Get V6 CLOB-only positions
  const v6Query = `
    SELECT
      condition_id,
      outcome_index,
      sum(usdc_delta) as cash_flow,
      sum(token_delta) as final_tokens
    FROM pm_unified_ledger_v6
    WHERE lower(wallet_address) = lower('${WALLET}')
      AND source_type = 'CLOB'
    GROUP BY condition_id, outcome_index
  `;

  const v6Result = await clickhouse.query({ query: v6Query, format: 'JSONEachRow' });
  const v6Rows = (await v6Result.json()) as any[];

  const v6Positions = new Map<string, Position>();
  for (const row of v6Rows) {
    // Normalize condition_id - remove 0x prefix if present, lowercase
    let condId = row.condition_id.toLowerCase();
    if (!condId.startsWith('0x')) {
      condId = '0x' + condId;
    }
    const key = `${condId}|${row.outcome_index}`;
    v6Positions.set(key, {
      condition_id: condId,
      outcome_index: Number(row.outcome_index),
      cash_flow: Number(row.cash_flow),
      final_tokens: Number(row.final_tokens),
    });
  }

  console.log(`\nV6 CLOB-only: ${v6Positions.size} positions`);

  // Get our TX-level positions
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
  const allTrades = (await tradeResult.json()) as any[];

  // TX-level maker-preferred dedupe
  const txGroups = new Map<string, any[]>();
  for (const t of allTrades) {
    const arr = txGroups.get(t.tx_hash) || [];
    arr.push(t);
    txGroups.set(t.tx_hash, arr);
  }

  const dedupedTrades: any[] = [];
  for (const [txHash, txTrades] of txGroups) {
    const makers = txTrades.filter((t: any) => t.role === 'maker');
    if (makers.length > 0) {
      dedupedTrades.push(...makers);
    } else {
      dedupedTrades.push(...txTrades);
    }
  }

  // Build our positions
  const ourPositions = new Map<string, Position>();
  for (const t of dedupedTrades) {
    let condId = t.condition_id.toLowerCase();
    if (!condId.startsWith('0x')) {
      condId = '0x' + condId;
    }
    const key = `${condId}|${t.outcome_index}`;
    const pos = ourPositions.get(key) || {
      condition_id: condId,
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

  console.log(`Our TX-level: ${ourPositions.size} positions`);

  // Compare
  console.log('\n\nPer-Position Comparison (showing mismatches only):');
  console.log('Condition (last 12) | Outcome | V6 Cash | Our Cash | V6 Tok | Our Tok | Match');
  console.log('-'.repeat(90));

  let matches = 0;
  let mismatches = 0;
  let inV6Only = 0;
  let inOursOnly = 0;

  const allKeys = new Set([...v6Positions.keys(), ...ourPositions.keys()]);

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
        console.log(
          `...${v6.condition_id.slice(-12)} | ${v6.outcome_index.toString().padStart(7)} | ` +
          `${v6.cash_flow.toFixed(2).padStart(7)} | ${ours.cash_flow.toFixed(2).padStart(8)} | ` +
          `${v6.final_tokens.toFixed(2).padStart(6)} | ${ours.final_tokens.toFixed(2).padStart(7)} | ✗`
        );
      }
    } else if (v6 && !ours) {
      inV6Only++;
      console.log(
        `...${v6.condition_id.slice(-12)} | ${v6.outcome_index.toString().padStart(7)} | ` +
        `${v6.cash_flow.toFixed(2).padStart(7)} |      --- | ` +
        `${v6.final_tokens.toFixed(2).padStart(6)} |     --- | V6 ONLY`
      );
    } else if (!v6 && ours) {
      inOursOnly++;
      console.log(
        `...${ours.condition_id.slice(-12)} | ${ours.outcome_index.toString().padStart(7)} | ` +
        `    --- | ${ours.cash_flow.toFixed(2).padStart(8)} | ` +
        `   --- | ${ours.final_tokens.toFixed(2).padStart(7)} | OURS ONLY`
      );
    }
  }

  console.log('-'.repeat(90));
  console.log(`\nSUMMARY: ${matches} match, ${mismatches} mismatch, ${inV6Only} V6-only, ${inOursOnly} ours-only`);
  console.log(`Match rate: ${(matches / allKeys.size * 100).toFixed(1)}%`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
