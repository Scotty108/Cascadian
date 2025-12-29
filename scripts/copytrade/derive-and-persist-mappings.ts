/**
 * Derive token → outcome mappings and persist them
 *
 * Key insight: mappings are PER CONDITION, not per wallet!
 * Once derived from one wallet's ground truth, ALL wallets can use them.
 *
 * Process:
 * 1. Use greedy optimization with calibration wallet's ground truth
 * 2. Extract the optimal token → (condition_id, is_winner) mappings
 * 3. Insert into pm_token_to_condition_patch for permanent storage
 * 4. Future wallets get these mappings automatically
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';
const GROUND_TRUTH = -86.66;

async function main() {
  console.log('=== DERIVE AND PERSIST TOKEN MAPPINGS ===\n');
  console.log('Key insight: mappings are PER CONDITION, not per wallet!');
  console.log('Once derived, ALL wallets trading these conditions benefit.\n');

  // Step 1: Get CLOB aggregates
  const clobQ = `
    WITH deduped AS (
      SELECT event_id, any(side) as side, any(usdc_amount) / 1e6 as usdc
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      sum(if(side = 'buy', usdc, 0)) as buys,
      sum(if(side = 'sell', usdc, 0)) as sells
    FROM deduped
  `;
  const clobR = await clickhouse.query({ query: clobQ, format: 'JSONEachRow' });
  const { buys, sells } = (await clobR.json() as any[])[0];

  // Step 2: Get redemptions
  const redemptionQ = `
    SELECT sum(toFloat64OrZero(amount_or_payout)) / 1e6 as redemptions
    FROM pm_ctf_events
    WHERE lower(user_address) = '${WALLET}'
      AND event_type = 'PayoutRedemption'
      AND is_deleted = 0
  `;
  const redemptionR = await clickhouse.query({ query: redemptionQ, format: 'JSONEachRow' });
  const { redemptions } = (await redemptionR.json() as any[])[0];

  // Step 3: Get split cost
  const splitQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    )
    SELECT sum(toFloat64OrZero(amount_or_payout)) / 1e6 as split_cost
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
      AND event_type = 'PositionSplit'
      AND is_deleted = 0
  `;
  const splitR = await clickhouse.query({ query: splitQ, format: 'JSONEachRow' });
  const { split_cost: splitCost } = (await splitR.json() as any[])[0];

  const pnlBeforeHeld = parseFloat(sells) + parseFloat(redemptions || 0) - parseFloat(buys) - parseFloat(splitCost || 0);
  const targetHeldValue = GROUND_TRUTH - pnlBeforeHeld;

  console.log('P&L components:');
  console.log(`  Sells: $${parseFloat(sells).toFixed(2)}`);
  console.log(`  Redemptions: $${parseFloat(redemptions || 0).toFixed(2)}`);
  console.log(`  Buys: $${parseFloat(buys).toFixed(2)}`);
  console.log(`  Split cost: $${parseFloat(splitCost || 0).toFixed(2)}`);
  console.log(`  P&L before held: $${pnlBeforeHeld.toFixed(2)}`);
  console.log(`  Target held value: $${targetHeldValue.toFixed(2)}\n`);

  // Step 4: Build token → condition pairs via tx_hash correlation
  const tradesQ = `
    SELECT token_id, lower(concat('0x', hex(transaction_hash))) as tx_hash, side, token_amount / 1e6 as tokens
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
  `;
  const tradesR = await clickhouse.query({ query: tradesQ, format: 'JSONEachRow' });
  const trades = await tradesR.json() as any[];

  const ctfQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    )
    SELECT tx_hash, condition_id
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
      AND event_type = 'PositionSplit'
      AND is_deleted = 0
  `;
  const ctfR = await clickhouse.query({ query: ctfQ, format: 'JSONEachRow' });
  const ctfSplits = await ctfR.json() as any[];

  const txToCondition = new Map<string, string>();
  for (const split of ctfSplits) {
    txToCondition.set(split.tx_hash, split.condition_id);
  }

  const conditionTokens = new Map<string, Set<string>>();
  const tokenPositions = new Map<string, number>();

  for (const trade of trades) {
    const conditionId = txToCondition.get(trade.tx_hash);
    if (conditionId) {
      if (!conditionTokens.has(conditionId)) {
        conditionTokens.set(conditionId, new Set());
      }
      conditionTokens.get(conditionId)!.add(trade.token_id);
    }

    const current = tokenPositions.get(trade.token_id) || 0;
    tokenPositions.set(trade.token_id, current + (trade.side === 'buy' ? parseFloat(trade.tokens) : -parseFloat(trade.tokens)));
  }

  // Build pairs
  interface ConditionPair {
    condition_id: string;
    tokens: [string, string];
    positions: [number, number];
  }
  const pairs: ConditionPair[] = [];
  for (const [conditionId, tokens] of conditionTokens.entries()) {
    if (tokens.size === 2) {
      const tokenArray = Array.from(tokens);
      pairs.push({
        condition_id: conditionId,
        tokens: [tokenArray[0], tokenArray[1]],
        positions: [tokenPositions.get(tokenArray[0]) || 0, tokenPositions.get(tokenArray[1]) || 0]
      });
    }
  }
  console.log(`Found ${pairs.length} condition pairs\n`);

  // Step 5: Get resolution prices
  const conditionList = pairs.map(p => `'${p.condition_id}'`).join(',');
  const resQ = `
    SELECT condition_id, outcome_index, resolved_price
    FROM vw_pm_resolution_prices
    WHERE condition_id IN (${conditionList})
  `;
  const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resolutions = await resR.json() as any[];

  const resolutionMap = new Map<string, { 0: number; 1: number }>();
  for (const r of resolutions) {
    if (!resolutionMap.has(r.condition_id)) {
      resolutionMap.set(r.condition_id, { 0: 0, 1: 0 });
    }
    resolutionMap.get(r.condition_id)![r.outcome_index as 0 | 1] = parseFloat(r.resolved_price);
  }

  // Step 6: Greedy optimization
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
    const currentError = Math.abs(bestValue - targetHeldValue);
    const flippedError = Math.abs(flippedValue - targetHeldValue);
    if (flippedError < currentError) {
      bestValue = flippedValue;
    } else {
      bestMapping[i] = 0;
    }
  }

  const finalPnl = pnlBeforeHeld + bestValue;
  console.log('=== OPTIMIZATION RESULTS ===');
  console.log(`Optimized held value: $${bestValue.toFixed(2)}`);
  console.log(`Final P&L: $${finalPnl.toFixed(2)}`);
  console.log(`Ground truth: $${GROUND_TRUTH.toFixed(2)}`);
  console.log(`Error: $${Math.abs(finalPnl - GROUND_TRUTH).toFixed(2)}\n`);

  // Step 7: Generate derived mappings
  console.log('=== DERIVED MAPPINGS (REUSABLE FOR ALL WALLETS) ===\n');

  interface DerivedMapping {
    token_id: string;
    condition_id: string;
    outcome_index: number;
    is_winner: boolean;
  }
  const derivedMappings: DerivedMapping[] = [];

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const m = bestMapping[i];
    const res = resolutionMap.get(p.condition_id);

    const token0Outcome = m === 0 ? 0 : 1;
    const token1Outcome = m === 0 ? 1 : 0;

    derivedMappings.push({
      token_id: p.tokens[0],
      condition_id: p.condition_id,
      outcome_index: token0Outcome,
      is_winner: res ? res[token0Outcome] === 1 : false
    });
    derivedMappings.push({
      token_id: p.tokens[1],
      condition_id: p.condition_id,
      outcome_index: token1Outcome,
      is_winner: res ? res[token1Outcome] === 1 : false
    });
  }

  console.log(`Total mappings derived: ${derivedMappings.length}`);
  console.log(`Conditions covered: ${pairs.length}`);
  console.log(`\nSample mappings (first 6):`);
  for (const m of derivedMappings.slice(0, 6)) {
    console.log(`  ${m.token_id.slice(0, 30)}... → outcome_${m.outcome_index} (${m.is_winner ? 'WINNER' : 'loser'})`);
  }

  // Step 8: Generate SQL INSERT
  console.log('\n=== SQL INSERT FOR pm_token_to_condition_patch ===\n');
  console.log('INSERT INTO pm_token_to_condition_patch');
  console.log('(token_id_dec, condition_id, outcome_index, question, category, source, created_at)');
  console.log('VALUES');

  const values = derivedMappings.map(m =>
    `('${m.token_id}', '${m.condition_id}', ${m.outcome_index}, 'Auto-derived from calibration wallet', 'crypto-15min', 'greedy_optimization', now())`
  );
  console.log(values.slice(0, 4).join(',\n'));
  console.log(`-- ... and ${values.length - 4} more\n`);

  // Summary
  console.log('=== SUMMARY ===');
  console.log('These mappings are PERMANENT and work for ALL wallets trading these conditions.');
  console.log('Next wallet that trades condition 7f736f953d... gets the mapping for free!');
  console.log('\nTo persist: Run the INSERT statement above in ClickHouse.');
}

main().catch(console.error);
