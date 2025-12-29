import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  const wallet = '0xd235973291b2b75ff4070e9c0b01728c520b0f29';

  console.log('=== SIMULATING POLYMARKET SUBGRAPH APPROACH ===');

  const tradesQuery = await clickhouse.query({
    query: `
      WITH deduped_trades AS (
        SELECT
          event_id,
          any(token_id) as token_id,
          any(side) as side,
          any(usdc_amount) / 1e6 as usdc,
          any(token_amount) / 1e6 as tokens,
          any(trade_time) as trade_time
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
        GROUP BY event_id
      )
      SELECT
        dt.event_id,
        dt.side,
        dt.usdc,
        dt.tokens,
        dt.trade_time,
        m.condition_id,
        m.outcome_index
      FROM deduped_trades dt
      INNER JOIN pm_token_to_condition_map_v5 m ON dt.token_id = m.token_id_dec
      ORDER BY dt.trade_time, dt.event_id
    `,
    format: 'JSONEachRow',
  });
  const trades = await tradesQuery.json() as any[];
  console.log(`Loaded ${trades.length} deduped trades`);

  // Position tracking
  interface Position {
    conditionId: string;
    outcomeIndex: number;
    quantity: number;
    avgPrice: number;
    realizedPnl: number;
    totalBought: number;
  }

  const positions = new Map<string, Position>();

  for (const trade of trades) {
    const condId = String(trade.condition_id).toLowerCase();
    const key = `${condId}|${trade.outcome_index}`;

    if (!positions.has(key)) {
      positions.set(key, {
        conditionId: condId,
        outcomeIndex: Number(trade.outcome_index),
        quantity: 0,
        avgPrice: 0,
        realizedPnl: 0,
        totalBought: 0,
      });
    }

    const pos = positions.get(key)!;
    const tokens = Number(trade.tokens);
    const usdc = Number(trade.usdc);
    const price = tokens > 0 ? usdc / tokens : 0;

    const side = String(trade.side).toLowerCase();
    if (side === 'buy') {
      if (tokens > 0) {
        const newAvgPrice = pos.quantity > 0
          ? (pos.avgPrice * pos.quantity + price * tokens) / (pos.quantity + tokens)
          : price;
        pos.avgPrice = newAvgPrice;
        pos.quantity += tokens;
        pos.totalBought += tokens;
      }
    } else {
      const tokensSold = tokens;
      const adjustedTokens = Math.min(tokensSold, pos.quantity);

      if (adjustedTokens > 0) {
        const sellPrice = usdc / tokensSold;
        const deltaPnl = adjustedTokens * (sellPrice - pos.avgPrice);
        pos.realizedPnl += deltaPnl;
        pos.quantity -= adjustedTokens;
      }
    }
  }

  // Get resolutions
  const resQuery = await clickhouse.query({
    query: `SELECT condition_id, payout_numerators FROM pm_condition_resolutions WHERE is_deleted = 0`,
    format: 'JSONEachRow',
  });
  const resolutions = await resQuery.json() as any[];
  const resMap = new Map<string, number[]>();
  for (const r of resolutions) {
    if (r.payout_numerators) {
      resMap.set(String(r.condition_id).toLowerCase(), JSON.parse(r.payout_numerators));
    }
  }

  let totalRealized = 0;
  let resolvedUnredeemedValue = 0;

  console.log('\n=== POSITION BREAKDOWN ===');
  for (const [key, pos] of positions.entries()) {
    const payouts = resMap.get(pos.conditionId);
    let payout = 0;
    if (payouts) {
      payout = payouts[pos.outcomeIndex] >= 1000 ? payouts[pos.outcomeIndex] / 10000 : payouts[pos.outcomeIndex];
    }

    totalRealized += pos.realizedPnl;

    if (pos.quantity > 0.01 && payouts) {
      const marketValue = pos.quantity * payout;
      const costBasis = pos.quantity * pos.avgPrice;
      const unrealizedPnl = marketValue - costBasis;
      resolvedUnredeemedValue += unrealizedPnl;

      if (Math.abs(pos.quantity) > 100) {
        console.log(`  ${pos.conditionId.slice(0,16)}... O${pos.outcomeIndex}: qty=${pos.quantity.toFixed(2)}, avgPrice=$${pos.avgPrice.toFixed(4)}, payout=${payout}, realized=$${pos.realizedPnl.toFixed(2)}, unrealized=$${unrealizedPnl.toFixed(2)}`);
      }
    }
  }

  console.log(`\n  Total Realized PnL: $${totalRealized.toFixed(2)}`);
  console.log(`  Resolved-Unredeemed Value: $${resolvedUnredeemedValue.toFixed(2)}`);
  console.log(`  UI Parity PnL (realized + unredeemed): $${(totalRealized + resolvedUnredeemedValue).toFixed(2)}`);
  console.log(`  UI benchmark: $7,807,265.59`);
}

main().catch(console.error);
