import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  // Get ALL fills for this wallet
  const fills = await clickhouse.query({
    query: `
      SELECT
        token_id,
        side,
        usdc_amount / 1e6 as usdc,
        token_amount / 1e6 as tokens,
        trade_time
      FROM (
        SELECT
          event_id,
          any(token_id) as token_id,
          any(side) as side,
          any(usdc_amount) as usdc_amount,
          any(token_amount) as token_amount,
          any(trade_time) as trade_time
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = '${WALLET}' AND is_deleted = 0
        GROUP BY event_id
      )
      ORDER BY token_id, trade_time
    `,
    format: 'JSONEachRow'
  }).then(r => r.json()) as any[];

  console.log('Total fills:', fills.length);

  // Group by token_id
  const tokenGroups: Map<string, any[]> = new Map();
  for (const fill of fills) {
    const key = fill.token_id;
    if (!tokenGroups.has(key)) {
      tokenGroups.set(key, []);
    }
    tokenGroups.get(key)!.push(fill);
  }

  let totalRealizedPnl = 0;
  let totalHeldTokens = 0;
  let totalHeldCostBasis = 0;
  let totalUnmatchedSellTokens = 0;
  let totalUnmatchedSellUsdc = 0;

  for (const [tokenId, tokenFills] of tokenGroups) {
    // Weighted average cost tracking
    let position = 0;  // current token balance
    let totalCost = 0; // total cost basis of position
    let realizedPnl = 0;
    let unmatchedSellTokens = 0;
    let unmatchedSellUsdc = 0;

    for (const fill of tokenFills) {
      const tokens = Number(fill.tokens);
      const usdc = Number(fill.usdc);

      if (fill.side.toLowerCase() === 'buy') {
        // Add to position at this cost
        totalCost += usdc;
        position += tokens;
      } else {
        // Sell
        if (position > 0.0001) {
          // We have tokens to sell
          const avgCost = totalCost / position;
          const sellQty = Math.min(tokens, position);
          const sellPrice = usdc / tokens;

          // Realized P&L on matched portion
          const pnl = (sellPrice - avgCost) * sellQty;
          realizedPnl += pnl;

          // Reduce position
          totalCost -= avgCost * sellQty;
          position -= sellQty;

          // Any excess is unmatched (from splits)
          const excess = tokens - sellQty;
          if (excess > 0.0001) {
            unmatchedSellTokens += excess;
            unmatchedSellUsdc += excess * sellPrice;
          }
        } else {
          // No position - all from splits
          unmatchedSellTokens += tokens;
          unmatchedSellUsdc += usdc;
        }
      }
    }

    totalRealizedPnl += realizedPnl;
    totalHeldTokens += Math.max(0, position);
    totalHeldCostBasis += Math.max(0, totalCost);
    totalUnmatchedSellTokens += unmatchedSellTokens;
    totalUnmatchedSellUsdc += unmatchedSellUsdc;
  }

  // Get redemptions
  const redemptions = await clickhouse.query({
    query: `
      SELECT sum(toFloat64OrZero(amount_or_payout)) / 1e6 as total
      FROM pm_ctf_events
      WHERE lower(user_address) = '${WALLET}' AND event_type = 'PayoutRedemption'
    `,
    format: 'JSONEachRow'
  }).then(r => r.json()) as any[];
  const redemptionUsdc = Number(redemptions[0]?.total || 0);

  console.log('\n=== WEIGHTED AVG COST P&L ===\n');
  console.log('Realized P&L from matched trades: $' + totalRealizedPnl.toFixed(2));
  console.log('Redemptions: $' + redemptionUsdc.toFixed(2));
  console.log('');
  console.log('Held tokens: ' + totalHeldTokens.toFixed(2) + ', cost basis: $' + totalHeldCostBasis.toFixed(2));
  console.log('Unmatched sells (from splits): ' + totalUnmatchedSellTokens.toFixed(2) + ' tokens, got $' + totalUnmatchedSellUsdc.toFixed(2));

  // Split cost = $1 per token
  const splitCost = totalUnmatchedSellTokens;
  const netFromSplits = totalUnmatchedSellUsdc - splitCost;

  console.log('Split cost ($1 each): $' + splitCost.toFixed(2));
  console.log('Net from splits: $' + netFromSplits.toFixed(2));
  console.log('');

  const totalRealized = totalRealizedPnl + netFromSplits + redemptionUsdc;
  console.log('=== TOTAL ===');
  console.log('Realized (trades): $' + totalRealizedPnl.toFixed(2));
  console.log('Net from splits: $' + netFromSplits.toFixed(2));
  console.log('Redemptions: $' + redemptionUsdc.toFixed(2));
  console.log('REALIZED P&L: $' + totalRealized.toFixed(2));
  console.log('');
  console.log('Held tokens cost basis: $' + totalHeldCostBasis.toFixed(2));
  console.log('If held tokens worth $0: Total = $' + (totalRealized - totalHeldCostBasis).toFixed(2));
  console.log('');
  console.log('Ground truth: $-86.66');
  console.log('Diff from realized: $' + (totalRealized - (-86.66)).toFixed(2));
}

main().catch(console.error);
