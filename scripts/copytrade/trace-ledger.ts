/**
 * Trace through the ledger for calibration step by step
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

interface InventoryPos {
  bought: number;
  split: number;
}

async function trace() {
  const wallet = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

  // 1) Load CLOB trades
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

  // 2) Load CTF events
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

  console.log('Loaded', trades.length, 'trades and', ctfEvents.length, 'CTF events');

  // 3) Token -> condition mapping (use patch table for calibration)
  const tokenIds = [...new Set(trades.map((t) => t.token_id))];
  const tokenToCondition = new Map<string, { conditionId: string; outcomeIndex: number }>();
  const tokenChunks = chunk(tokenIds, CHUNK_SIZE);
  for (const c of tokenChunks) {
    const mappingQ = `
      SELECT token_id_dec as token_id, condition_id, outcome_index
      FROM pm_token_to_condition_patch
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
  console.log('Mapped', tokenToCondition.size, '/', tokenIds.length, 'tokens');

  // 4) Condition -> outcomes mapping
  const conditionIds = [...new Set([...tokenToCondition.values()].map((m) => m.conditionId))];
  const outcomeMap = new Map<string, Map<number, string>>();
  if (conditionIds.length > 0) {
    const conditionChunks = chunk(conditionIds, CHUNK_SIZE);
    for (const c of conditionChunks) {
      const outcomeQ = `
        SELECT condition_id, outcome_index, token_id_dec as token_id
        FROM pm_token_to_condition_patch
        WHERE condition_id IN ({conditionIds:Array(String)})
      `;
      const outcomeR = await clickhouse.query({
        query: outcomeQ,
        query_params: { conditionIds: c },
        format: 'JSONEachRow',
      });
      const rows = (await outcomeR.json()) as Array<{
        condition_id: string;
        outcome_index: number;
        token_id: string;
      }>;
      for (const row of rows) {
        const outcomes = outcomeMap.get(row.condition_id) || new Map<number, string>();
        outcomes.set(Number(row.outcome_index), row.token_id);
        outcomeMap.set(row.condition_id, outcomes);
      }
    }
  }
  console.log('Outcome maps for', outcomeMap.size, 'conditions');

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
  console.log('Resolution prices for', resMap.size, 'conditions');

  // 6) Process ledger
  const inventory = new Map<string, InventoryPos>();
  const getPos = (tokenId: string): InventoryPos => {
    const p = inventory.get(tokenId);
    if (p) return p;
    const newPos = { bought: 0, split: 0 };
    inventory.set(tokenId, newPos);
    return newPos;
  };

  let buys = 0,
    sells = 0,
    redemptions = 0,
    splitCost = 0,
    implicitSplits = 0;

  const inferSplit = (conditionId: string, amount: number) => {
    if (amount <= 0) return;
    const outcomes = outcomeMap.get(conditionId);
    if (!outcomes) return;
    for (const tokenId of outcomes.values()) {
      const pos = getPos(tokenId);
      pos.split += amount;
    }
    splitCost += amount;
    implicitSplits += amount;
  };

  // Process CLOB trades
  for (const trade of trades) {
    const mapping = tokenToCondition.get(trade.token_id);
    if (!mapping) continue;

    const pos = getPos(trade.token_id);

    if (trade.side === 'buy') {
      pos.bought += trade.tokens;
      buys += trade.usdc;
    } else {
      const available = pos.bought + pos.split;
      const deficit = Math.max(0, trade.tokens - available);

      if (deficit > 0) {
        inferSplit(mapping.conditionId, deficit);
      }

      // Consume inventory
      let remaining = trade.tokens;
      if (pos.bought > 0) {
        const use = Math.min(pos.bought, remaining);
        pos.bought -= use;
        remaining -= use;
      }
      if (remaining > 0 && pos.split > 0) {
        const use = Math.min(pos.split, remaining);
        pos.split -= use;
        remaining -= use;
      }
      if (remaining > 0) {
        pos.bought -= remaining;
      }

      sells += trade.usdc;
    }
  }

  console.log('\n=== AFTER CLOB TRADES ===');
  console.log('Buys:', buys.toFixed(0));
  console.log('Sells:', sells.toFixed(0));
  console.log('Implicit splits:', implicitSplits.toFixed(0));

  // Check inventory before CTF events
  let tokensInInventory = 0;
  for (const [tokenId, pos] of inventory.entries()) {
    const net = pos.bought + pos.split;
    if (net > 0) tokensInInventory += net;
  }
  console.log('Tokens in inventory:', tokensInInventory.toFixed(0));

  // Process CTF events (redemptions)
  for (const e of ctfEvents) {
    if (e.event_type === 'PayoutRedemption') {
      const prices = resMap.get(e.condition_id);
      if (!prices) continue;

      // Find winner
      let winnerIdx: number | null = null;
      let winnerPrice = 0;
      for (const [idx, price] of prices.entries()) {
        if (price > winnerPrice) {
          winnerPrice = price;
          winnerIdx = idx;
        }
      }
      if (winnerIdx === null || winnerPrice <= 0) continue;

      const outcomes = outcomeMap.get(e.condition_id);
      const winnerTokenId = outcomes?.get(winnerIdx);
      if (!winnerTokenId) continue;

      const tokenAmount = e.amount / winnerPrice;
      const pos = getPos(winnerTokenId);
      const available = pos.bought + pos.split;

      // If insufficient inventory, infer split
      if (tokenAmount > available) {
        const deficit = tokenAmount - available;
        console.log(
          `\nRedemption needs ${tokenAmount.toFixed(2)} tokens of ${winnerTokenId.slice(0, 10)}...`
        );
        console.log(`  Available: ${available.toFixed(2)}, deficit: ${deficit.toFixed(2)}`);
        console.log(`  Inferring split of ${deficit.toFixed(2)}`);
        inferSplit(e.condition_id, deficit);
      }

      // Consume inventory
      let remaining = tokenAmount;
      const posFresh = getPos(winnerTokenId);
      if (posFresh.bought > 0) {
        const use = Math.min(posFresh.bought, remaining);
        posFresh.bought -= use;
        remaining -= use;
      }
      if (remaining > 0 && posFresh.split > 0) {
        const use = Math.min(posFresh.split, remaining);
        posFresh.split -= use;
        remaining -= use;
      }

      redemptions += e.amount;
    }
  }

  console.log('\n=== AFTER CTF EVENTS ===');
  console.log('Redemptions:', redemptions.toFixed(0));
  console.log('Total split cost:', splitCost.toFixed(0));

  // 7) Calculate held value
  let heldValue = 0;
  let openPositions = 0;
  let heldTokenDetails: Array<{ token: string; net: number; price: number; value: number }> = [];

  for (const [tokenId, pos] of inventory.entries()) {
    const net = pos.bought + pos.split;
    if (net <= 0) continue;

    const mapping = tokenToCondition.get(tokenId);
    if (!mapping) continue;

    const price = resMap.get(mapping.conditionId)?.get(mapping.outcomeIndex);
    if (price === undefined || price === null) {
      openPositions++;
      continue;
    }

    const value = net * price;
    heldValue += value;
    heldTokenDetails.push({
      token: tokenId.slice(0, 10),
      net,
      price,
      value,
    });
  }

  console.log('\n=== HELD VALUE BREAKDOWN ===');
  console.log('Open positions:', openPositions);
  console.log('Held value:', heldValue.toFixed(2));

  if (heldTokenDetails.length > 0) {
    console.log('\nTokens with value:');
    for (const d of heldTokenDetails.slice(0, 10)) {
      console.log(`  ${d.token}: ${d.net.toFixed(2)} tokens × ${d.price} = $${d.value.toFixed(2)}`);
    }
    if (heldTokenDetails.length > 10) {
      console.log(`  ... and ${heldTokenDetails.length - 10} more`);
    }
  }

  // Final P&L
  const realizedPnl = sells + redemptions - buys - splitCost + heldValue;
  console.log('\n=== FINAL P&L ===');
  console.log('Formula: Sells + Redemptions - Buys - SplitCost + HeldValue');
  console.log(`${sells.toFixed(0)} + ${redemptions.toFixed(0)} - ${buys.toFixed(0)} - ${splitCost.toFixed(0)} + ${heldValue.toFixed(0)}`);
  console.log('P&L:', realizedPnl.toFixed(2));
  console.log('Target: -$86');
}

trace().catch(console.error);
