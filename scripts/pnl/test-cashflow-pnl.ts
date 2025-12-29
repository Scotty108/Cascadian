/**
 * Test CASH FLOW PnL approach
 *
 * This computes: USDC received - USDC spent + value of held shares
 * For resolved markets, held shares are valued at resolution price (1 or 0)
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

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

  // Load ALL trades with cash flow details
  const tradeResult = await client.query({
    query: `
      WITH deduped AS (
        SELECT event_id,
          any(token_id) as token_id,
          any(side) as side,
          any(token_amount)/1e6 as tokens,
          any(usdc_amount)/1e6 as usdc,
          any(trade_time) as trade_time
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
        GROUP BY event_id
      ) SELECT * FROM deduped ORDER BY trade_time
    `,
    format: 'JSONEachRow',
  });
  const trades = (await tradeResult.json()) as any[];

  // Track raw net tokens per position
  const positions = new Map<string, { netTokens: number; usdcSpent: number; usdcReceived: number }>();

  for (const t of trades) {
    const pos = positions.get(t.token_id) || { netTokens: 0, usdcSpent: 0, usdcReceived: 0 };

    if (t.side === 'buy') {
      pos.netTokens += Number(t.tokens);
      pos.usdcSpent += Number(t.usdc);
    } else {
      pos.netTokens -= Number(t.tokens);
      pos.usdcReceived += Number(t.usdc);
    }
    positions.set(t.token_id, pos);
  }

  // Calculate cash flow PnL
  let totalUsdcSpent = 0;
  let totalUsdcReceived = 0;
  let totalHeldValue = 0;
  let winningHeld = 0;
  let losingHeld = 0;

  interface PositionDetail {
    tokenId: string;
    netTokens: number;
    usdcSpent: number;
    usdcReceived: number;
    payout: number | null;
    heldValue: number;
    netPnl: number;
  }
  const details: PositionDetail[] = [];

  for (const [tokenId, pos] of positions) {
    totalUsdcSpent += pos.usdcSpent;
    totalUsdcReceived += pos.usdcReceived;

    const payout = resolutions.get(tokenId);
    let heldValue = 0;

    if (pos.netTokens > 0 && payout !== undefined) {
      // Held shares with known resolution
      heldValue = pos.netTokens * payout;
      totalHeldValue += heldValue;
      if (payout > 0) winningHeld += pos.netTokens;
      else losingHeld += pos.netTokens;
    } else if (pos.netTokens > 0) {
      // Unresolved position - skip for now
    }

    const netPnl = pos.usdcReceived - pos.usdcSpent + heldValue;
    if (Math.abs(netPnl) > 10000) {
      details.push({
        tokenId: tokenId.slice(0, 15) + '...',
        netTokens: pos.netTokens,
        usdcSpent: pos.usdcSpent,
        usdcReceived: pos.usdcReceived,
        payout: payout ?? null,
        heldValue,
        netPnl,
      });
    }
  }

  console.log('Cash Flow PnL Analysis:');
  console.log('=======================');
  console.log('Total USDC spent (buys):', Math.round(totalUsdcSpent).toLocaleString());
  console.log('Total USDC received (sells):', Math.round(totalUsdcReceived).toLocaleString());
  console.log('Trading cash flow:', Math.round(totalUsdcReceived - totalUsdcSpent).toLocaleString());
  console.log('');
  console.log('Held share values:');
  console.log('  Winning shares held:', winningHeld.toFixed(0), 'tokens');
  console.log('  Losing shares held:', losingHeld.toFixed(0), 'tokens');
  console.log('  Total held value:', Math.round(totalHeldValue).toLocaleString());
  console.log('');
  const totalPnl = totalUsdcReceived - totalUsdcSpent + totalHeldValue;
  console.log('TOTAL CASH FLOW PnL:', Math.round(totalPnl).toLocaleString());
  console.log('');
  console.log('Comparison:');
  console.log('  Fresh UI (Dec 16):', '$' + freshUiPnl.toLocaleString());
  console.log('  Cash Flow PnL:', '$' + Math.round(totalPnl).toLocaleString());
  const error = ((totalPnl - freshUiPnl) / freshUiPnl) * 100;
  console.log('  Error:', error.toFixed(1) + '%');

  // Show biggest losers
  console.log('\n=== Top 10 Biggest Losing Positions ===');
  details.sort((a, b) => a.netPnl - b.netPnl);
  for (const d of details.slice(0, 10)) {
    console.log(
      `${d.tokenId}: net ${d.netTokens.toFixed(0)} tokens, spent $${d.usdcSpent.toFixed(0)}, rcvd $${d.usdcReceived.toFixed(0)}, payout=${d.payout}, held=$${d.heldValue.toFixed(0)}, PnL=$${d.netPnl.toFixed(0)}`
    );
  }
}

main().catch(console.error);
