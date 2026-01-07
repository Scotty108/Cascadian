import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const wallet = '0xf918977ef9d3f101385eda508621d5f835fa9052';

interface Trade {
  side: string;
  usdc: number;
  tokens: number;
  token_id: string;
  trade_time: string;
}

interface Position {
  tokens: number;
  totalCost: number;
  avgCost: number;
}

async function calcPnlMakerOnly() {
  console.log('PNL CALCULATION - MAKER EVENTS ONLY');
  console.log('Wallet:', wallet);
  console.log('='.repeat(90));

  // Get all MAKER trades (event_id ends with -m), filtered for primary trades (price > 0.5)
  const q = `
    SELECT
      side,
      usdc_amount / 1e6 as usdc,
      token_amount / 1e6 as tokens,
      token_id,
      trade_time
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${wallet}'
      AND is_deleted = 0
      AND event_id LIKE '%-m'
      AND (usdc_amount / 1e6) / (token_amount / 1e6) > 0.5
    ORDER BY trade_time
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const trades = (await r.json()) as Trade[];

  console.log(`\nFound ${trades.length} maker trades (price > 0.5)\n`);

  // Get resolutions for markets this wallet traded
  const tokenIds = [...new Set(trades.map(t => t.token_id))];
  console.log(`Trading ${tokenIds.length} unique tokens\n`);

  // Track positions using Polymarket's weighted average cost method
  const positions = new Map<string, Position>();
  let totalRealizedPnl = 0;

  console.log('TRADE-BY-TRADE CALCULATION:');
  console.log('-'.repeat(90));

  for (const trade of trades) {
    const key = trade.token_id;
    let pos = positions.get(key) || { tokens: 0, totalCost: 0, avgCost: 0 };

    if (trade.side === 'buy') {
      // Update weighted average cost
      const newTotalCost = pos.totalCost + trade.usdc;
      const newTokens = pos.tokens + trade.tokens;
      const newAvgCost = newTotalCost / newTokens;
      const buyPrice = trade.usdc / trade.tokens;

      console.log(`BUY  ${trade.tokens.toFixed(6)} @ $${buyPrice.toFixed(4)} | Total: ${newTokens.toFixed(6)} @ avg $${newAvgCost.toFixed(4)}`);

      positions.set(key, { tokens: newTokens, totalCost: newTotalCost, avgCost: newAvgCost });
    } else if (trade.side === 'sell') {
      const sellPrice = trade.usdc / trade.tokens;
      const pnl = (sellPrice - pos.avgCost) * trade.tokens;
      totalRealizedPnl += pnl;

      console.log(`SELL ${trade.tokens.toFixed(6)} @ $${sellPrice.toFixed(4)} | Avg cost: $${pos.avgCost.toFixed(4)} | PnL: $${pnl.toFixed(4)}`);

      // Reduce position
      const newTokens = pos.tokens - trade.tokens;
      const newTotalCost = pos.avgCost * newTokens;
      positions.set(key, { tokens: newTokens, totalCost: newTotalCost, avgCost: pos.avgCost });
    }
  }

  // Now check for redemptions - get resolution prices for positions
  console.log('\n' + '-'.repeat(90));
  console.log('CHECKING RESOLUTIONS FOR REMAINING POSITIONS:');

  for (const [tokenId, pos] of positions) {
    if (pos.tokens > 0.001) {
      // Check if this token resolved
      const resQ = `
        SELECT
          resolved_payout
        FROM vw_market_metadata_v4_materialized
        WHERE token_id = '${tokenId}'
      `;

      try {
        const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
        const resRows = await resR.json() as any[];

        if (resRows.length > 0 && resRows[0].resolved_payout !== null) {
          const payout = Number(resRows[0].resolved_payout);
          const pnl = (payout - pos.avgCost) * pos.tokens;
          totalRealizedPnl += pnl;
          console.log(`RESOLVED: ${pos.tokens.toFixed(6)} tokens @ payout $${payout.toFixed(2)} | Avg cost: $${pos.avgCost.toFixed(4)} | PnL: $${pnl.toFixed(4)}`);
        } else {
          console.log(`UNRESOLVED: ${pos.tokens.toFixed(6)} tokens held @ avg $${pos.avgCost.toFixed(4)} | token: ${tokenId.slice(0, 20)}...`);
        }
      } catch (e) {
        console.log(`Error checking resolution for token ${tokenId.slice(0, 20)}...`);
      }
    }
  }

  console.log('\n' + '='.repeat(90));
  console.log(`CALCULATED REALIZED PNL: $${totalRealizedPnl.toFixed(2)}`);
  console.log(`UI SHOWS:                $1.16`);
  console.log(`DIFFERENCE:              $${(totalRealizedPnl - 1.16).toFixed(2)}`);
  console.log('='.repeat(90));
}

calcPnlMakerOnly();
