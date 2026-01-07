/**
 * Calculate PnL using ALL CLOB trades (maker + taker)
 * With split cost basis ($0.50) for external sells
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

interface Position {
  tokenId: string;
  amount: number;       // Current token balance
  costBasis: number;    // Total cost paid
  avgPrice: number;     // Weighted average price
  realizedPnl: number;  // PnL from sells
  fromSplits: number;   // Tokens assumed from splits (external buys)
}

function emptyPosition(tokenId: string): Position {
  return {
    tokenId,
    amount: 0,
    costBasis: 0,
    avgPrice: 0,
    realizedPnl: 0,
    fromSplits: 0,
  };
}

const SPLIT_COST = 0.50; // Cost per token from splits

async function main() {
  const wallet = process.argv[2] || '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae';

  console.log('═'.repeat(70));
  console.log('ALL TRADES PNL CALCULATION');
  console.log(`Wallet: ${wallet.slice(0, 12)}...`);
  console.log('═'.repeat(70));

  // Load ALL trades (maker + taker), deduped by event_id
  const tradesResult = await client.query({
    query: `
      WITH deduped AS (
        SELECT
          event_id,
          any(token_id) as token_id,
          any(side) as side,
          any(usdc_amount) / 1e6 as usdc,
          any(token_amount) / 1e6 as tokens,
          any(trade_time) as trade_time,
          any(block_number) as block_number
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
        GROUP BY event_id
      )
      SELECT
        d.event_id,
        d.token_id,
        d.side,
        d.usdc,
        d.tokens,
        d.trade_time,
        d.block_number,
        m.condition_id,
        m.outcome_index
      FROM deduped d
      LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
      ORDER BY d.block_number, d.event_id
    `,
    format: 'JSONEachRow'
  });
  const trades = await tradesResult.json() as any[];

  console.log(`\nLoaded ${trades.length} trades (all roles)`);

  // Process trades through cost basis engine
  const positions = new Map<string, Position>();
  let totalExternalTokens = 0;
  let totalVolume = 0;

  for (const trade of trades) {
    const tokenId = trade.token_id;
    const tokens = Number(trade.tokens);
    const usdc = Number(trade.usdc);
    const price = tokens > 0 ? usdc / tokens : 0;

    let pos = positions.get(tokenId) || emptyPosition(tokenId);
    totalVolume += usdc;

    if (trade.side === 'buy') {
      // Normal buy - add to inventory
      const newCost = pos.costBasis + usdc;
      const newAmount = pos.amount + tokens;
      pos.avgPrice = newAmount > 0 ? newCost / newAmount : 0;
      pos.costBasis = newCost;
      pos.amount = newAmount;
    } else {
      // Sell
      if (pos.amount >= tokens) {
        // Have inventory - use tracked cost basis
        const soldCost = tokens * pos.avgPrice;
        pos.realizedPnl += usdc - soldCost;
        pos.costBasis -= soldCost;
        pos.amount -= tokens;
      } else {
        // Partial or no inventory - split into tracked + external
        const trackedTokens = pos.amount;
        const externalTokens = tokens - trackedTokens;

        if (trackedTokens > 0) {
          // Sell tracked inventory first
          const trackedCost = trackedTokens * pos.avgPrice;
          const trackedValue = (trackedTokens / tokens) * usdc;
          pos.realizedPnl += trackedValue - trackedCost;
          pos.costBasis = 0;
          pos.amount = 0;
        }

        // External tokens assumed from splits at $0.50
        if (externalTokens > 0) {
          const externalValue = (externalTokens / tokens) * usdc;
          const externalCost = externalTokens * SPLIT_COST;
          pos.realizedPnl += externalValue - externalCost;
          pos.fromSplits += externalTokens;
          totalExternalTokens += externalTokens;
        }
      }
    }

    positions.set(tokenId, pos);
  }

  // Load resolutions
  const tokenIds = [...positions.keys()];
  const resolutions = new Map<string, { payout: number; isResolved: boolean }>();

  if (tokenIds.length > 0) {
    const CHUNK_SIZE = 500;
    for (let i = 0; i < tokenIds.length; i += CHUNK_SIZE) {
      const chunk = tokenIds.slice(i, i + CHUNK_SIZE);
      const tokenList = chunk.map(t => `'${t}'`).join(',');

      const resResult = await client.query({
        query: `
          SELECT
            m.token_id_dec as token_id,
            r.payout_numerators,
            m.outcome_index
          FROM pm_token_to_condition_map_v5 m
          LEFT JOIN pm_condition_resolutions r ON lower(m.condition_id) = lower(r.condition_id)
          WHERE m.token_id_dec IN (${tokenList})
        `,
        format: 'JSONEachRow'
      });
      const rows = await resResult.json() as any[];

      for (const row of rows) {
        let payout = 0.5;
        let isResolved = false;

        if (row.payout_numerators) {
          try {
            const payouts = JSON.parse(row.payout_numerators.replace(/'/g, '"'));
            const idx = Number(row.outcome_index);
            const total = payouts.reduce((a: number, b: number) => a + b, 0);
            payout = total > 0 ? payouts[idx] / total : 0;
            isResolved = true;
          } catch {}
        }

        resolutions.set(row.token_id, { payout, isResolved });
      }
    }
  }

  // Calculate final PnL
  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;
  let winCount = 0;
  let lossCount = 0;

  for (const [tokenId, pos] of positions) {
    const res = resolutions.get(tokenId);
    const isResolved = res?.isResolved ?? false;
    const payout = res?.payout ?? 0.5;

    if (isResolved) {
      // Settlement value for remaining tokens
      const settlementPnl = pos.amount * (payout - pos.avgPrice);
      const totalPnl = pos.realizedPnl + settlementPnl;
      realizedPnl += totalPnl;
      resolvedCount++;

      if (totalPnl > 0) winCount++;
      else if (totalPnl < 0) lossCount++;
    } else {
      // Only count realized PnL for unresolved
      realizedPnl += pos.realizedPnl;
      unresolvedCount++;
    }
  }

  // Results
  console.log('\n' + '─'.repeat(70));
  console.log('RESULTS');
  console.log('─'.repeat(70));
  console.log(`Total PnL:        $${realizedPnl.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`Positions:        ${positions.size}`);
  console.log(`Resolved:         ${resolvedCount}`);
  console.log(`Unresolved:       ${unresolvedCount}`);
  console.log(`Win/Loss:         ${winCount}/${lossCount}`);
  console.log(`Win Rate:         ${resolvedCount > 0 ? ((winCount / (winCount + lossCount)) * 100).toFixed(1) : 0}%`);
  console.log(`\nExternal tokens (assumed from splits): ${(totalExternalTokens / 1e6).toFixed(2)}M`);
  console.log(`Volume traded:    $${(totalVolume / 1e6).toFixed(2)}M`);

  console.log('\n' + '═'.repeat(70));
  console.log('COMPARISON');
  console.log('═'.repeat(70));
  console.log(`CCR-v1 (maker only):  $411,803`);
  console.log(`All trades + splits:  $${realizedPnl.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`Expected UI:          ~$400K (based on +2.1% match)`);

  await client.close();
}

main().catch(console.error);
