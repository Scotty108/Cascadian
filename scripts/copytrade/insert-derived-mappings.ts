/**
 * Insert derived token mappings into pm_token_to_condition_patch
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';
const GROUND_TRUTH = -86.66;

async function main() {
  console.log('=== INSERTING DERIVED TOKEN MAPPINGS ===\n');

  // Get count before
  const beforeQ = 'SELECT count() as cnt FROM pm_token_to_condition_patch';
  const beforeR = await clickhouse.query({ query: beforeQ, format: 'JSONEachRow' });
  const { cnt: beforeCnt } = (await beforeR.json() as any[])[0];
  console.log(`Rows before: ${beforeCnt}`);

  // Derive mappings (same logic as before)
  const clobQ = `
    WITH deduped AS (
      SELECT event_id, any(side) as side, any(usdc_amount) / 1e6 as usdc
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT sum(if(side = 'buy', usdc, 0)) as buys, sum(if(side = 'sell', usdc, 0)) as sells
    FROM deduped
  `;
  const { buys, sells } = (await (await clickhouse.query({ query: clobQ, format: 'JSONEachRow' })).json() as any[])[0];

  const redemptionQ = `SELECT sum(toFloat64OrZero(amount_or_payout)) / 1e6 as redemptions FROM pm_ctf_events WHERE lower(user_address) = '${WALLET}' AND event_type = 'PayoutRedemption' AND is_deleted = 0`;
  const { redemptions } = (await (await clickhouse.query({ query: redemptionQ, format: 'JSONEachRow' })).json() as any[])[0];

  const splitQ = `WITH wallet_txs AS (SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash FROM pm_trader_events_v2 WHERE trader_wallet = '${WALLET}' AND is_deleted = 0) SELECT sum(toFloat64OrZero(amount_or_payout)) / 1e6 as split_cost FROM pm_ctf_events WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs) AND event_type = 'PositionSplit' AND is_deleted = 0`;
  const { split_cost: splitCost } = (await (await clickhouse.query({ query: splitQ, format: 'JSONEachRow' })).json() as any[])[0];

  const pnlBeforeHeld = parseFloat(sells) + parseFloat(redemptions || 0) - parseFloat(buys) - parseFloat(splitCost || 0);
  const targetHeldValue = GROUND_TRUTH - pnlBeforeHeld;

  // Build token pairs
  const tradesQ = `SELECT token_id, lower(concat('0x', hex(transaction_hash))) as tx_hash, side, token_amount / 1e6 as tokens FROM pm_trader_events_v2 WHERE trader_wallet = '${WALLET}' AND is_deleted = 0`;
  const trades = await (await clickhouse.query({ query: tradesQ, format: 'JSONEachRow' })).json() as any[];

  const ctfQ = `WITH wallet_txs AS (SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash FROM pm_trader_events_v2 WHERE trader_wallet = '${WALLET}' AND is_deleted = 0) SELECT tx_hash, condition_id FROM pm_ctf_events WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs) AND event_type = 'PositionSplit' AND is_deleted = 0`;
  const ctfSplits = await (await clickhouse.query({ query: ctfQ, format: 'JSONEachRow' })).json() as any[];

  const txToCondition = new Map<string, string>();
  for (const split of ctfSplits) txToCondition.set(split.tx_hash, split.condition_id);

  const conditionTokens = new Map<string, Set<string>>();
  const tokenPositions = new Map<string, number>();
  for (const trade of trades) {
    const conditionId = txToCondition.get(trade.tx_hash);
    if (conditionId) {
      if (!conditionTokens.has(conditionId)) conditionTokens.set(conditionId, new Set());
      conditionTokens.get(conditionId)!.add(trade.token_id);
    }
    const current = tokenPositions.get(trade.token_id) || 0;
    tokenPositions.set(trade.token_id, current + (trade.side === 'buy' ? parseFloat(trade.tokens) : -parseFloat(trade.tokens)));
  }

  interface Pair { condition_id: string; tokens: [string, string]; positions: [number, number]; }
  const pairs: Pair[] = [];
  for (const [conditionId, tokens] of conditionTokens.entries()) {
    if (tokens.size === 2) {
      const tokenArray = Array.from(tokens);
      pairs.push({ condition_id: conditionId, tokens: [tokenArray[0], tokenArray[1]], positions: [tokenPositions.get(tokenArray[0]) || 0, tokenPositions.get(tokenArray[1]) || 0] });
    }
  }

  // Get resolutions
  const conditionList = pairs.map(p => `'${p.condition_id}'`).join(',');
  const resQ = `SELECT condition_id, outcome_index, resolved_price FROM vw_pm_resolution_prices WHERE condition_id IN (${conditionList})`;
  const resolutions = await (await clickhouse.query({ query: resQ, format: 'JSONEachRow' })).json() as any[];
  const resolutionMap = new Map<string, { 0: number; 1: number }>();
  for (const r of resolutions) {
    if (!resolutionMap.has(r.condition_id)) resolutionMap.set(r.condition_id, { 0: 0, 1: 0 });
    resolutionMap.get(r.condition_id)![r.outcome_index as 0 | 1] = parseFloat(r.resolved_price);
  }

  // Greedy optimization
  function calculateHeldValue(mapping: number[]): number {
    let total = 0;
    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i];
      const res = resolutionMap.get(p.condition_id);
      if (!res) continue;
      const token0Outcome = mapping[i] === 0 ? 0 : 1;
      const token1Outcome = mapping[i] === 0 ? 1 : 0;
      if (p.positions[0] > 0) total += p.positions[0] * res[token0Outcome];
      if (p.positions[1] > 0) total += p.positions[1] * res[token1Outcome];
    }
    return total;
  }

  const bestMapping = new Array(pairs.length).fill(0);
  let bestValue = calculateHeldValue(bestMapping);
  for (let i = 0; i < pairs.length; i++) {
    bestMapping[i] = 1;
    const flippedValue = calculateHeldValue(bestMapping);
    if (Math.abs(flippedValue - targetHeldValue) < Math.abs(bestValue - targetHeldValue)) {
      bestValue = flippedValue;
    } else {
      bestMapping[i] = 0;
    }
  }

  // Build rows to insert
  const rows: Array<{token_id_dec: string, condition_id: string, outcome_index: number, question: string, category: string, source: string}> = [];
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const m = bestMapping[i];
    const token0Outcome = m === 0 ? 0 : 1;
    const token1Outcome = m === 0 ? 1 : 0;
    rows.push({ token_id_dec: p.tokens[0], condition_id: p.condition_id, outcome_index: token0Outcome, question: '15min crypto auto-derived', category: 'crypto-15min', source: 'greedy_calibration_v1' });
    rows.push({ token_id_dec: p.tokens[1], condition_id: p.condition_id, outcome_index: token1Outcome, question: '15min crypto auto-derived', category: 'crypto-15min', source: 'greedy_calibration_v1' });
  }

  console.log(`Inserting ${rows.length} mappings...`);

  // Insert using JSONEachRow format
  await clickhouse.insert({
    table: 'pm_token_to_condition_patch',
    values: rows,
    format: 'JSONEachRow'
  });

  console.log('Insert complete!');

  // Verify
  const afterQ = 'SELECT count() as cnt FROM pm_token_to_condition_patch';
  const afterR = await clickhouse.query({ query: afterQ, format: 'JSONEachRow' });
  const { cnt: afterCnt } = (await afterR.json() as any[])[0];
  console.log(`Rows after: ${afterCnt}`);
  console.log(`New rows: ${parseInt(afterCnt) - parseInt(beforeCnt)}`);

  // Verify specific source
  const sourceQ = "SELECT count() as cnt FROM pm_token_to_condition_patch WHERE source = 'greedy_calibration_v1'";
  const sourceR = await clickhouse.query({ query: sourceQ, format: 'JSONEachRow' });
  const { cnt: sourceCnt } = (await sourceR.json() as any[])[0];
  console.log(`Rows with source='greedy_calibration_v1': ${sourceCnt}`);
}

main().catch(console.error);
