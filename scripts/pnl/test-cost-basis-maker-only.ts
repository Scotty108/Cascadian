/**
 * Test Cost Basis Engine with MAKER-ONLY trades (like V6)
 *
 * Run with: npx tsx scripts/pnl/test-cost-basis-maker-only.ts
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

const THEO4 = '0x56687bf447db6ffa42ffe2204a05edaa20f55839';

async function main() {
  const client = getClickHouseClient();

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   COST BASIS WITH MAKER-ONLY (like V6)                                     ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  // Load MAKER-ONLY trades
  const tradesResult = await client.query({
    query: `
      WITH deduped AS (
        SELECT
          event_id,
          any(token_id) as token_id,
          any(side) as side,
          any(token_amount) / 1000000.0 as token_amount,
          any(usdc_amount) / 1000000.0 as usdc_amount,
          any(trade_time) as trade_time
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${THEO4}'
          AND role = 'maker'
          AND is_deleted = 0
        GROUP BY event_id
      )
      SELECT * FROM deduped ORDER BY trade_time
    `,
    format: 'JSONEachRow',
  });
  const trades = (await tradesResult.json()) as any[];
  console.log(`Loaded ${trades.length} maker-only trades`);

  // Load resolutions
  // IMPORTANT: payout_numerators can be [1,0] (normalized) or [1000000,0] (raw)
  // V6 formula: if(value >= 1000, 1, value) - don't divide for small values!
  const resResult = await client.query({
    query: `
      SELECT
        m.token_id_dec as token_id,
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
  console.log(`Loaded ${resolutions.size} resolutions`);

  // Process trades
  const positions = new Map<string, Position>();
  let totalExternal = 0;

  for (const t of trades) {
    const tokenId = t.token_id;
    let position = positions.get(tokenId) || emptyPosition(THEO4, tokenId);

    const price =
      Number(t.token_amount) > 0 ? Number(t.usdc_amount) / Number(t.token_amount) : 0;

    if (t.side === 'buy') {
      position = updateWithBuy(position, Number(t.token_amount), price);
    } else {
      const { position: newPos, result } = updateWithSell(
        position,
        Number(t.token_amount),
        price
      );
      position = newPos;
      totalExternal += result.externalSell;
    }

    positions.set(tokenId, position);
  }

  // Calculate PnL
  let totalRealized = 0;
  let totalUnrealized = 0;
  let winnerPositions = 0;
  let loserPositions = 0;
  let unresolvedPositions = 0;

  for (const [tokenId, pos] of positions) {
    totalRealized += pos.realizedPnl;

    const payout = resolutions.get(tokenId);
    if (payout !== undefined && pos.amount > 0) {
      const unrealized = pos.amount * (payout - pos.avgPrice);
      totalUnrealized += unrealized;

      if (payout >= 0.5) winnerPositions++;
      else loserPositions++;
    } else if (pos.amount > 0) {
      unresolvedPositions++;
    }
  }

  console.log(`\nProcessed ${positions.size} unique tokens`);
  console.log(`Winner positions (payout >= 0.5): ${winnerPositions}`);
  console.log(`Loser positions (payout < 0.5): ${loserPositions}`);
  console.log(`Unresolved positions: ${unresolvedPositions}`);
  console.log(`External sells: ${totalExternal.toLocaleString()} tokens`);

  console.log(`\n--- PnL ---`);
  console.log(`Realized: $${totalRealized.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  console.log(`Unrealized: $${totalUnrealized.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  console.log(`Total: $${(totalRealized + totalUnrealized).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

  // Compare to V6
  const v6Pnl = 22158110;
  console.log(`\n--- V6 for comparison ---`);
  console.log(`V6 PnL: $${v6Pnl.toLocaleString()}`);

  const error = ((totalRealized + totalUnrealized - v6Pnl) / v6Pnl) * 100;
  console.log(`Error vs V6: ${error.toFixed(2)}%`);

  // Debug: Show some winner positions
  console.log(`\n--- Sample Winner Positions ---`);
  let count = 0;
  for (const [tokenId, pos] of positions) {
    const payout = resolutions.get(tokenId);
    if (payout !== undefined && payout >= 0.5 && pos.amount > 1000) {
      const unrealized = pos.amount * (payout - pos.avgPrice);
      console.log(`Token: ${tokenId.slice(0, 30)}...`);
      console.log(`  Amount: ${pos.amount.toLocaleString()}`);
      console.log(`  Avg Price: $${pos.avgPrice.toFixed(4)}`);
      console.log(`  Payout: $${payout}`);
      console.log(`  Unrealized: $${unrealized.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
      count++;
      if (count >= 3) break;
    }
  }

  // Debug: Show some loser positions
  console.log(`\n--- Sample Loser Positions ---`);
  count = 0;
  for (const [tokenId, pos] of positions) {
    const payout = resolutions.get(tokenId);
    if (payout !== undefined && payout < 0.5 && pos.amount > 1000) {
      const unrealized = pos.amount * (payout - pos.avgPrice);
      console.log(`Token: ${tokenId.slice(0, 30)}...`);
      console.log(`  Amount: ${pos.amount.toLocaleString()}`);
      console.log(`  Avg Price: $${pos.avgPrice.toFixed(4)}`);
      console.log(`  Payout: $${payout}`);
      console.log(`  Unrealized: $${unrealized.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
      count++;
      if (count >= 3) break;
    }
  }
}

main().catch(console.error);
