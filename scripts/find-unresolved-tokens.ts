/**
 * Find which token_ids are being marked as "unresolved" by the engine
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function findUnresolved() {
  // Get all held token_ids (same logic as engine)
  const tradesQ = `
    SELECT
      side,
      usdc / 1e6 AS usdc,
      tokens / 1e6 AS tokens,
      token_id,
      trade_time
    FROM (
      SELECT
        side,
        token_id,
        any(usdc_amount) AS usdc,
        token_amount AS tokens,
        max(trade_time) AS trade_time
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
      GROUP BY transaction_hash, side, token_id, token_amount
    )
    ORDER BY trade_time
  `;

  const tradesR = await clickhouse.query({ query: tradesQ, format: 'JSONEachRow' });
  const trades = (await tradesR.json()) as any[];

  // Build positions
  const positions = new Map<string, { amount: number; avgPrice: number }>();

  for (const trade of trades) {
    const key = trade.token_id;
    let pos = positions.get(key) || { amount: 0, avgPrice: 0 };
    const price = trade.usdc / trade.tokens;

    if (trade.side === 'buy') {
      const numerator = pos.avgPrice * pos.amount + price * trade.tokens;
      const denominator = pos.amount + trade.tokens;
      pos.amount = pos.amount + trade.tokens;
      pos.avgPrice = denominator > 0 ? numerator / denominator : 0;
      positions.set(key, pos);
    } else if (trade.side === 'sell') {
      const adjustedAmount = Math.min(pos.amount, trade.tokens);
      if (adjustedAmount >= 0.01) {
        pos.amount = pos.amount - adjustedAmount;
        positions.set(key, pos);
      }
    }
  }

  // Get held positions
  const heldTokenIds = Array.from(positions.entries())
    .filter(([_, pos]) => pos.amount > 0.01)
    .map(([tokenId, _]) => tokenId);

  console.log('Held token count:', heldTokenIds.length);

  // Query resolution for each token_id
  const resQ = `
    SELECT
      m.token_id_dec,
      m.condition_id,
      m.outcome_index,
      r.payout_numerators
    FROM pm_token_to_condition_map_v5 m
    LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
    WHERE m.token_id_dec IN (
      SELECT DISTINCT token_id
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
    )
  `;

  const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resRows = (await resR.json()) as any[];

  console.log('Resolution rows returned:', resRows.length);

  // Build resolution map
  const tokenResolution = new Map<string, { payout: number; resolved: boolean; condition_id: string }>();
  for (const r of resRows) {
    if (r.payout_numerators) {
      const payouts = JSON.parse(r.payout_numerators.replace(/'/g, '"'));
      const payout = payouts[r.outcome_index] > 0 ? 1.0 : 0.0;
      tokenResolution.set(r.token_id_dec, { payout, resolved: true, condition_id: r.condition_id });
    } else {
      tokenResolution.set(r.token_id_dec, { payout: 0, resolved: false, condition_id: r.condition_id });
    }
  }

  console.log('Token resolution map size:', tokenResolution.size);

  // Find unresolved tokens
  let unresolvedCount = 0;
  let unmappedCount = 0;
  const unresolvedTokens: { tokenId: string; pos: any; conditionId: string | null; reason: string }[] = [];

  for (const tokenId of heldTokenIds) {
    const resolution = tokenResolution.get(tokenId);
    const pos = positions.get(tokenId)!;

    if (!resolution) {
      unresolvedTokens.push({ tokenId, pos, conditionId: null, reason: 'unmapped' });
      unmappedCount++;
    } else if (!resolution.resolved) {
      unresolvedTokens.push({ tokenId, pos, conditionId: resolution.condition_id, reason: 'no_payout' });
      unresolvedCount++;
    }
  }

  console.log('\nUnmapped count:', unmappedCount);
  console.log('No payout (unresolved) count:', unresolvedCount);
  console.log('Total unresolved:', unmappedCount + unresolvedCount);

  console.log('\nUnresolved tokens (first 15):');
  for (const t of unresolvedTokens.slice(0, 15)) {
    console.log(`  Token: ${t.tokenId.slice(0, 30)}...`);
    console.log(`    Reason: ${t.reason}`);
    console.log(`    Condition: ${t.conditionId?.slice(0, 50) || 'UNMAPPED'}`);
    console.log(`    Position: ${t.pos.amount.toFixed(2)} shares @ $${t.pos.avgPrice.toFixed(4)}`);
    console.log(`    Cost basis: $${(t.pos.amount * t.pos.avgPrice).toFixed(2)}`);
    console.log('');
  }

  // Sum up the cost basis of all unresolved
  const totalUnresolvedCostBasis = unresolvedTokens.reduce((sum, t) => sum + (t.pos.amount * t.pos.avgPrice), 0);
  console.log('Total unresolved cost basis:', '$' + totalUnresolvedCostBasis.toFixed(2));

  // Check one specific unresolved condition_id directly in DB
  if (unresolvedTokens.length > 0 && unresolvedTokens[0].conditionId) {
    const cid = unresolvedTokens[0].conditionId;
    console.log('\n--- Direct DB check for first condition_id ---');
    console.log('Condition ID:', cid);

    const checkQ = `
      SELECT condition_id, payout_numerators
      FROM pm_condition_resolutions
      WHERE condition_id = '${cid}'
    `;
    const checkR = await clickhouse.query({ query: checkQ, format: 'JSONEachRow' });
    const checkRows = (await checkR.json()) as any[];
    console.log('Direct lookup result:', checkRows.length > 0 ? checkRows[0] : 'NOT FOUND');

    // Try with normalization
    const checkQ2 = `
      SELECT condition_id, payout_numerators
      FROM pm_condition_resolutions
      WHERE lower(condition_id) = lower('${cid}')
    `;
    const checkR2 = await clickhouse.query({ query: checkQ2, format: 'JSONEachRow' });
    const checkRows2 = (await checkR2.json()) as any[];
    console.log('Case-insensitive lookup:', checkRows2.length > 0 ? checkRows2[0] : 'NOT FOUND');
  }
}

findUnresolved();
