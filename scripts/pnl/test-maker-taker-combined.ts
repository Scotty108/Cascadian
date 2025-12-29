/**
 * Test cost-basis engine with BOTH maker and taker trades
 *
 * This tests whether including taker activity improves accuracy.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import {
  emptyPosition,
  updateWithBuy,
  updateWithSell,
  Position,
} from '../../lib/pnl/costBasisEngineV1';

async function main() {
  const client = getClickHouseClient();
  const wallet = '0x7f3c8979d0afa00007bae4747d5347122af05613';
  const freshUiPnl = 214154;

  // Load resolutions
  const resResult = await client.query({
    query: `
      SELECT m.token_id_dec as token_id,
        if(r.payout_numerators IS NULL, NULL,
           if(JSONExtractInt(r.payout_numerators, m.outcome_index + 1) >= 1000, 1,
              JSONExtractInt(r.payout_numerators, m.outcome_index + 1))) as payout
      FROM pm_token_to_condition_map_v5 m
      LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      WHERE r.payout_numerators IS NOT NULL
    `,
    format: 'JSONEachRow',
  });
  const resRows = (await resResult.json()) as any[];
  const resolutions = new Map<string, number>();
  for (const r of resRows) {
    if (r.payout !== null) resolutions.set(r.token_id, Number(r.payout));
  }

  // Load ALL trades (maker + taker)
  const tradeResult = await client.query({
    query: `
      WITH deduped AS (
        SELECT event_id, any(token_id) as token_id, any(side) as side,
          any(token_amount)/1e6 as tokens, any(usdc_amount)/1e6 as usdc,
          any(trade_time) as trade_time
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
        GROUP BY event_id
      ) SELECT * FROM deduped ORDER BY trade_time
    `,
    format: 'JSONEachRow',
  });
  const trades = (await tradeResult.json()) as any[];

  // Process with cost-basis engine
  const positions = new Map<string, Position>();
  let totalExternal = 0;

  for (const t of trades) {
    let pos = positions.get(t.token_id) || emptyPosition(wallet, t.token_id);
    const price = Number(t.tokens) > 0 ? Number(t.usdc) / Number(t.tokens) : 0;

    if (t.side === 'buy') {
      pos = updateWithBuy(pos, Number(t.tokens), price);
    } else {
      const { position: newPos, result } = updateWithSell(pos, Number(t.tokens), price);
      pos = newPos;
      totalExternal += result.externalSell;
    }
    positions.set(t.token_id, pos);
  }

  // Calculate PnL
  let totalRealized = 0;
  let totalUnrealized = 0;
  let winCount = 0,
    lossCount = 0,
    openCount = 0;
  let winValue = 0,
    lossValue = 0;

  for (const [tokenId, pos] of positions) {
    totalRealized += pos.realizedPnl;
    const payout = resolutions.get(tokenId);
    if (payout !== undefined && pos.amount > 0) {
      const unrealized = pos.amount * (payout - pos.avgPrice);
      totalUnrealized += unrealized;
      if (payout > 0) {
        winCount++;
        winValue += unrealized;
      } else {
        lossCount++;
        lossValue += unrealized;
      }
    } else if (pos.amount > 0) {
      openCount++;
    }
  }

  console.log('Cost-Basis Engine (MAKER + TAKER combined):');
  console.log('============================================');
  console.log('Trades processed:', trades.length);
  console.log('Unique positions:', positions.size);
  console.log('External sells (capped):', totalExternal.toFixed(0));
  console.log('');
  console.log('Results:');
  console.log('  Realized PnL:', Math.round(totalRealized).toLocaleString());
  console.log('  Unrealized PnL:', Math.round(totalUnrealized).toLocaleString());
  console.log('  TOTAL PnL:', Math.round(totalRealized + totalUnrealized).toLocaleString());
  console.log('');
  console.log('Position breakdown:');
  console.log('  Win positions:', winCount, '($' + Math.round(winValue).toLocaleString() + ')');
  console.log('  Loss positions:', lossCount, '($' + Math.round(lossValue).toLocaleString() + ')');
  console.log('  Open positions:', openCount);
  console.log('');
  console.log('Comparison:');
  console.log('  Fresh UI (Dec 16):', '$' + freshUiPnl.toLocaleString());
  console.log('  Engine total:', '$' + Math.round(totalRealized + totalUnrealized).toLocaleString());
  const error = ((totalRealized + totalUnrealized - freshUiPnl) / freshUiPnl) * 100;
  console.log('  Error:', error.toFixed(1) + '%');
}

main().catch(console.error);
