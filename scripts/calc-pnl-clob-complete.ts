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

interface TokenResolution {
  condition_id: string;
  outcome_index: number;
  payouts: number[];
  payout_denominator: number;
  resolved: boolean;
  winning_payout: number;
}

async function getTokenResolution(tokenId: string): Promise<TokenResolution | null> {
  // Get mapping
  const mapQ = `
    SELECT condition_id, outcome_index
    FROM pm_token_to_condition_map_v5
    WHERE token_id_dec = '${tokenId}'
  `;

  const mapR = await clickhouse.query({ query: mapQ, format: 'JSONEachRow' });
  const mapRows = (await mapR.json()) as any[];

  if (mapRows.length === 0) {
    return null;
  }

  const m = mapRows[0];

  // Get resolution
  const resQ = `
    SELECT payout_numerators, payout_denominator
    FROM pm_condition_resolutions
    WHERE condition_id = '${m.condition_id}'
  `;

  const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resRows = (await resR.json()) as any[];

  if (resRows.length === 0) {
    return {
      condition_id: m.condition_id,
      outcome_index: m.outcome_index,
      payouts: [],
      payout_denominator: 1,
      resolved: false,
      winning_payout: 0,
    };
  }

  const res = resRows[0];
  const payouts = JSON.parse(res.payout_numerators.replace(/'/g, '"'));
  const denom = parseInt(res.payout_denominator);

  // For binary markets, payout is simply the numerator value (0 or 1)
  // The denominator is for normalization in multi-outcome markets
  const winning_payout = payouts[m.outcome_index] > 0 ? 1.0 : 0.0;

  return {
    condition_id: m.condition_id,
    outcome_index: m.outcome_index,
    payouts,
    payout_denominator: denom,
    resolved: true,
    winning_payout,
  };
}

async function calcPnlClobComplete() {
  console.log('COMPLETE PNL CALCULATION - CLOB + RESOLUTIONS');
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

  // Track positions using Polymarket's weighted average cost method
  const positions = new Map<string, Position>();
  let tradingPnl = 0;

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

      console.log(
        `BUY  ${trade.tokens.toFixed(6)} @ $${buyPrice.toFixed(4)} | Total: ${newTokens.toFixed(6)} @ avg $${newAvgCost.toFixed(4)}`
      );

      positions.set(key, { tokens: newTokens, totalCost: newTotalCost, avgCost: newAvgCost });
    } else if (trade.side === 'sell') {
      const sellPrice = trade.usdc / trade.tokens;
      const pnl = (sellPrice - pos.avgCost) * trade.tokens;
      tradingPnl += pnl;

      console.log(
        `SELL ${trade.tokens.toFixed(6)} @ $${sellPrice.toFixed(4)} | Avg cost: $${pos.avgCost.toFixed(4)} | PnL: $${pnl.toFixed(4)}`
      );

      // Reduce position
      const newTokens = pos.tokens - trade.tokens;
      const newTotalCost = pos.avgCost * newTokens;
      positions.set(key, { tokens: newTokens, totalCost: newTotalCost, avgCost: pos.avgCost });
    }
  }

  console.log('\n' + '-'.repeat(90));
  console.log(`TRADING PNL (sells only): $${tradingPnl.toFixed(4)}`);

  // Now check for resolutions on remaining positions
  console.log('\n' + '-'.repeat(90));
  console.log('RESOLUTION PNL (held to resolution):');

  let resolutionPnl = 0;

  for (const [tokenId, pos] of positions) {
    if (pos.tokens > 0.001) {
      const resolution = await getTokenResolution(tokenId);

      if (resolution === null) {
        console.log(`  ⚠️  Token ${tokenId.slice(0, 20)}... not found in mapping`);
      } else if (!resolution.resolved) {
        console.log(
          `  📊 UNRESOLVED: ${pos.tokens.toFixed(4)} tokens @ avg $${pos.avgCost.toFixed(4)} | condition: ${resolution.condition_id.slice(0, 16)}...`
        );
      } else if (resolution.winning_payout > 0) {
        // Winner - payout at $1.00
        const pnl = (1.0 - pos.avgCost) * pos.tokens;
        resolutionPnl += pnl;
        console.log(
          `  ✅ WON: ${pos.tokens.toFixed(4)} tokens @ $1.00 | Avg cost: $${pos.avgCost.toFixed(4)} | PnL: $${pnl.toFixed(4)}`
        );
      } else {
        // Loser - payout at $0.00
        const pnl = (0.0 - pos.avgCost) * pos.tokens;
        resolutionPnl += pnl;
        console.log(
          `  ❌ LOST: ${pos.tokens.toFixed(4)} tokens @ $0.00 | Avg cost: $${pos.avgCost.toFixed(4)} | PnL: $${pnl.toFixed(4)}`
        );
      }
    }
  }

  console.log(`\nRESOLUTION PNL: $${resolutionPnl.toFixed(4)}`);

  const totalPnl = tradingPnl + resolutionPnl;

  console.log('\n' + '='.repeat(90));
  console.log(`TRADING PNL:    $${tradingPnl.toFixed(2)}`);
  console.log(`RESOLUTION PNL: $${resolutionPnl.toFixed(2)}`);
  console.log(`TOTAL PNL:      $${totalPnl.toFixed(2)}`);
  console.log('='.repeat(90));
  console.log(`UI SHOWS:       $1.16`);
  console.log(`DIFFERENCE:     $${(totalPnl - 1.16).toFixed(2)}`);
  console.log('='.repeat(90));
}

calcPnlClobComplete();
