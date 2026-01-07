/**
 * Trade-by-trade analysis of wallet f918 to find $0.18 gap
 * CCR-v1 shows $1.34, UI shows $1.16
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

interface Trade {
  event_id: string;
  token_id: string;
  side: string;
  usdc: number;
  tokens: number;
  trade_time: string;
  condition_id: string | null;
  outcome_index: number | null;
  payout_numerators: string | null;
}

async function analyzeTrades() {
  const wallet = '0xf918977EF9d3f101385EDA508621d5f835FA9052';

  // Get all trades with market info
  const query = `
    WITH trades AS (
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
      ORDER BY trade_time, event_id
    )
    SELECT
      t.event_id,
      t.token_id,
      t.side,
      t.usdc,
      t.tokens,
      t.trade_time,
      m.condition_id,
      m.outcome_index,
      r.payout_numerators
    FROM trades t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    LEFT JOIN pm_condition_resolutions r ON lower(m.condition_id) = lower(r.condition_id)
    ORDER BY t.trade_time, t.event_id
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as Trade[];

  console.log('Trade-by-Trade Analysis for', wallet);
  console.log('='.repeat(120));
  console.log('Total trades:', rows.length);
  console.log('');

  // Group by condition_id to see market-level activity
  const byCondition = new Map<string, Trade[]>();
  for (const row of rows) {
    const cid = row.condition_id || 'UNKNOWN';
    const existing = byCondition.get(cid);
    if (existing) {
      existing.push(row);
    } else {
      byCondition.set(cid, [row]);
    }
  }

  console.log('Unique markets (conditions):', byCondition.size);
  console.log('');

  // Process each condition separately
  let totalRealizedPnl = 0;
  let totalUnrealizedPnl = 0;

  for (const [conditionId, trades] of byCondition) {
    console.log('---');
    console.log('Condition:', conditionId ? conditionId.slice(0, 20) + '...' : 'UNKNOWN');

    // Check resolution
    const payout_numerators = trades[0].payout_numerators;
    let isResolved = false;
    let payouts: number[] = [];

    if (payout_numerators) {
      try {
        payouts = JSON.parse(payout_numerators.replace(/'/g, '"'));
        isResolved = true;
      } catch {
        // Parse error
      }
    }
    console.log('Resolved:', isResolved, payouts.length > 0 ? 'payouts=' + JSON.stringify(payouts) : '');

    // Group by outcome_index (YES=0 vs NO=1 typically)
    const byOutcome = new Map<number, Trade[]>();
    for (const t of trades) {
      const idx = Number(t.outcome_index) || 0;
      const existing = byOutcome.get(idx);
      if (existing) {
        existing.push(t);
      } else {
        byOutcome.set(idx, [t]);
      }
    }

    for (const [outcomeIdx, outcomeTrades] of byOutcome) {
      const payout = isResolved ? (payouts[outcomeIdx] > 0 ? 1.0 : 0.0) : 0.5;

      // Apply cost basis accounting
      let amount = 0;
      let avgPrice = 0;
      let realizedPnl = 0;

      console.log(`  Outcome ${outcomeIdx} (payout=$${payout.toFixed(2)}):`);

      for (const t of outcomeTrades) {
        const price = t.tokens > 0 ? t.usdc / t.tokens : 0;

        if (t.side === 'buy') {
          // Update weighted average price
          const newAmount = amount + t.tokens;
          avgPrice = newAmount > 0 ? (avgPrice * amount + price * t.tokens) / newAmount : price;
          amount = newAmount;
          console.log(
            `    BUY  ${t.tokens.toFixed(4)} @ $${price.toFixed(4)} → pos=${amount.toFixed(4)}, avg=$${avgPrice.toFixed(4)}`
          );
        } else {
          // Sell - cap at inventory
          const sellQty = Math.min(t.tokens, amount);
          const externalSell = t.tokens - sellQty;

          if (sellQty > 0) {
            const pnl = sellQty * (price - avgPrice);
            realizedPnl += pnl;
            amount -= sellQty;
            console.log(
              `    SELL ${t.tokens.toFixed(4)} @ $${price.toFixed(4)} → realized=$${pnl.toFixed(4)}, pos=${amount.toFixed(4)}`
            );
          }
          if (externalSell > 0) {
            console.log(`    EXTERNAL SELL ${externalSell.toFixed(4)} (no tracked inventory)`);
          }
        }
      }

      // Settlement
      const settlementPnl = amount * (payout - avgPrice);
      console.log(
        `    Settlement: ${amount.toFixed(4)} tokens @ payout=$${payout.toFixed(2)} vs avg=$${avgPrice.toFixed(4)} → $${settlementPnl.toFixed(4)}`
      );

      const totalPositionPnl = realizedPnl + settlementPnl;
      console.log(
        `    Position PnL: $${totalPositionPnl.toFixed(4)} (realized=$${realizedPnl.toFixed(4)} + settlement=$${settlementPnl.toFixed(4)})`
      );

      if (isResolved) {
        totalRealizedPnl += totalPositionPnl;
      } else {
        totalRealizedPnl += realizedPnl;
        totalUnrealizedPnl += settlementPnl;
      }
    }
  }

  console.log('');
  console.log('='.repeat(120));
  console.log('TOTAL REALIZED PNL:', totalRealizedPnl.toFixed(4));
  console.log('TOTAL UNREALIZED PNL:', totalUnrealizedPnl.toFixed(4));
  console.log('TOTAL PNL:', (totalRealizedPnl + totalUnrealizedPnl).toFixed(4));
  console.log('');
  console.log('CCR-v1 reported: $1.34');
  console.log('UI reported: $1.16');
  console.log('Difference: $0.18');

  process.exit(0);
}

analyzeTrades();
