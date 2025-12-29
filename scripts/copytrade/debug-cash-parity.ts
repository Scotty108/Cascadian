/**
 * Debug Cash Parity Ledger - trace what's happening for calibration
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';

const CHUNK_SIZE = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function debug() {
  const wallet = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

  // 1) Load all CLOB trades, ordered by time
  const tradesQ = `
    SELECT
      side,
      usdc_amount/1e6 as usdc,
      token_amount/1e6 as tokens,
      token_id,
      trade_time
    FROM pm_trader_events_dedup_v2_tbl
    WHERE trader_wallet = '${wallet}'
    ORDER BY trade_time ASC
  `;
  const tradesR = await clickhouse.query({ query: tradesQ, format: 'JSONEachRow' });
  const trades = (await tradesR.json()) as Array<{
    side: 'buy' | 'sell';
    usdc: number;
    tokens: number;
    token_id: string;
    trade_time: string;
  }>;

  console.log(`Loaded ${trades.length} trades`);

  // Aggregate by side
  let totalBuys = 0, totalSells = 0;
  let tokensBought = 0, tokensSold = 0;
  for (const t of trades) {
    if (t.side === 'buy') {
      totalBuys += t.usdc;
      tokensBought += t.tokens;
    } else {
      totalSells += t.usdc;
      tokensSold += t.tokens;
    }
  }

  console.log(`\nTrade Summary:`);
  console.log(`  Buys: $${totalBuys.toFixed(0)} (${tokensBought.toFixed(0)} tokens)`);
  console.log(`  Sells: $${totalSells.toFixed(0)} (${tokensSold.toFixed(0)} tokens)`);
  console.log(`  Net tokens: ${(tokensBought - tokensSold).toFixed(0)}`);

  // 2) CTF events
  const ctfQ = `
    SELECT
      event_type,
      condition_id,
      toFloat64OrZero(amount_or_payout) / 1e6 as amount,
      event_timestamp
    FROM pm_ctf_events
    WHERE lower(user_address) = '${wallet}'
      AND event_type IN ('PositionSplit', 'PositionsMerge', 'PayoutRedemption')
      AND is_deleted = 0
    ORDER BY event_timestamp ASC
  `;
  const ctfR = await clickhouse.query({ query: ctfQ, format: 'JSONEachRow' });
  const ctfEvents = (await ctfR.json()) as Array<{
    event_type: 'PositionSplit' | 'PositionsMerge' | 'PayoutRedemption';
    condition_id: string;
    amount: number;
    event_timestamp: string;
  }>;

  console.log(`\nCTF Events:`);
  const eventSummary = new Map<string, { count: number; total: number }>();
  for (const e of ctfEvents) {
    const summary = eventSummary.get(e.event_type) || { count: 0, total: 0 };
    summary.count++;
    summary.total += e.amount;
    eventSummary.set(e.event_type, summary);
  }
  for (const [type, summary] of eventSummary) {
    console.log(`  ${type}: ${summary.count} events, $${summary.total.toFixed(0)}`);
  }

  // 3) Token mapping
  const tokenIds = [...new Set(trades.map((t) => t.token_id))];
  console.log(`\nUnique tokens: ${tokenIds.length}`);

  const tokenToCondition = new Map<string, { conditionId: string; outcomeIndex: number }>();
  const tokenChunks = chunk(tokenIds, CHUNK_SIZE);
  for (const c of tokenChunks) {
    const mappingQ = `
      SELECT token_id_dec as token_id, condition_id, outcome_index
      FROM pm_token_to_condition_map_v5
      WHERE token_id_dec IN ({tokenIds:Array(String)})
    `;
    const mappingR = await clickhouse.query({
      query: mappingQ,
      query_params: { tokenIds: c },
      format: 'JSONEachRow',
    });
    const mapped = (await mappingR.json()) as Array<{
      token_id: string;
      condition_id: string;
      outcome_index: number;
    }>;
    for (const row of mapped) {
      tokenToCondition.set(row.token_id, {
        conditionId: row.condition_id,
        outcomeIndex: Number(row.outcome_index),
      });
    }
  }

  console.log(`Mapped tokens: ${tokenToCondition.size}`);

  // 4) Get all conditions
  const conditionIds = [...new Set([...tokenToCondition.values()].map((m) => m.conditionId))];
  console.log(`Conditions: ${conditionIds.length}`);

  // 5) Resolution prices
  const resMap = new Map<string, Map<number, number>>();
  if (conditionIds.length > 0) {
    const resQ = `
      SELECT condition_id, outcome_index, resolved_price
      FROM vw_pm_resolution_prices
      WHERE condition_id IN ({conditionIds:Array(String)})
    `;
    const resR = await clickhouse.query({
      query: resQ,
      query_params: { conditionIds },
      format: 'JSONEachRow',
    });
    const resRows = (await resR.json()) as Array<{
      condition_id: string;
      outcome_index: number;
      resolved_price: number;
    }>;
    for (const row of resRows) {
      const m = resMap.get(row.condition_id) || new Map<number, number>();
      m.set(Number(row.outcome_index), Number(row.resolved_price));
      resMap.set(row.condition_id, m);
    }
  }

  const resolvedConditions = resMap.size;
  console.log(`Resolved conditions: ${resolvedConditions} / ${conditionIds.length}`);

  // 6) Trace through ledger for a few tokens
  console.log('\n=== TOKEN FLOW TRACE ===\n');

  // Group trades by token_id
  const tradesByToken = new Map<string, Array<typeof trades[0]>>();
  for (const t of trades) {
    const list = tradesByToken.get(t.token_id) || [];
    list.push(t);
    tradesByToken.set(t.token_id, list);
  }

  // Find tokens with the most activity
  const tokenActivity = [...tradesByToken.entries()]
    .map(([tokenId, trades]) => ({
      tokenId,
      tradeCount: trades.length,
      buys: trades.filter((t) => t.side === 'buy').reduce((sum, t) => sum + t.tokens, 0),
      sells: trades.filter((t) => t.side === 'sell').reduce((sum, t) => sum + t.tokens, 0),
    }))
    .sort((a, b) => b.tradeCount - a.tradeCount)
    .slice(0, 5);

  for (const token of tokenActivity) {
    const mapping = tokenToCondition.get(token.tokenId);
    const resPrice = mapping ? resMap.get(mapping.conditionId)?.get(mapping.outcomeIndex) : undefined;

    console.log(`Token ${token.tokenId.slice(0, 10)}...`);
    console.log(`  Trades: ${token.tradeCount}`);
    console.log(`  Bought: ${token.buys.toFixed(2)} tokens`);
    console.log(`  Sold: ${token.sells.toFixed(2)} tokens`);
    console.log(`  Net: ${(token.buys - token.sells).toFixed(2)} tokens`);
    console.log(`  Deficit: ${Math.max(0, token.sells - token.buys).toFixed(2)} (needs split)`);
    console.log(`  Resolution price: ${resPrice !== undefined ? resPrice : 'unresolved'}`);
    console.log('');
  }

  // Calculate total deficit across all tokens
  let totalDeficit = 0;
  for (const [tokenId, trades] of tradesByToken.entries()) {
    const buys = trades.filter((t) => t.side === 'buy').reduce((sum, t) => sum + t.tokens, 0);
    const sells = trades.filter((t) => t.side === 'sell').reduce((sum, t) => sum + t.tokens, 0);
    totalDeficit += Math.max(0, sells - buys);
  }

  console.log(`\nTotal token deficit (split need): ${totalDeficit.toFixed(0)} tokens = $${totalDeficit.toFixed(0)}`);

  // Calculate held value from net positions
  let heldValue = 0;
  let openCount = 0;
  for (const [tokenId, trades] of tradesByToken.entries()) {
    const buys = trades.filter((t) => t.side === 'buy').reduce((sum, t) => sum + t.tokens, 0);
    const sells = trades.filter((t) => t.side === 'sell').reduce((sum, t) => sum + t.tokens, 0);
    const net = buys - sells;
    if (net <= 0) continue;

    const mapping = tokenToCondition.get(tokenId);
    if (!mapping) continue;

    const price = resMap.get(mapping.conditionId)?.get(mapping.outcomeIndex);
    if (price === undefined) {
      openCount++;
      continue;
    }

    heldValue += net * price;
  }

  console.log(`\nNaive held value (net position * res price): $${heldValue.toFixed(0)}`);
  console.log(`Open positions (no resolution): ${openCount}`);

  // The issue: we're NOT accounting for tokens created by splits
  // In the cash parity model, splits create tokens for ALL outcomes
  // So if you sell outcome A (which triggers a split), you also get outcome B
  console.log('\n=== SPLIT CREATES BOTH OUTCOMES ===');
  console.log('When calibration sells YES tokens without buying them:');
  console.log('  - Ledger infers a split (sells > bought)');
  console.log('  - Split creates BOTH YES and NO tokens');
  console.log('  - YES tokens are consumed by the sell');
  console.log('  - NO tokens remain in inventory');
  console.log('  - If NO wins, those tokens have held value');
  console.log('');
  console.log('This explains the $971 held value - its the unsold side of splits');
}

debug().catch(console.error);
