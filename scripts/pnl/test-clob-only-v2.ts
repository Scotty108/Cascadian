/**
 * Test CLOB-Only V2 - Use weighted average cost basis per position
 *
 * Process trades in order, building position state.
 */

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

interface PositionState {
  amount: number;
  totalCost: number;
  realizedPnl: number;
}

async function main() {
  console.log('='.repeat(80));
  console.log('TEST: CLOB-ONLY V2 (WEIGHTED AVG COST BASIS)');
  console.log('='.repeat(80));

  // Get all CLOB trades with proper deduplication, ordered by time
  const tradesQuery = `
    SELECT
      m.condition_id,
      m.outcome_index,
      fills.trade_time,
      fills.side,
      fills.qty_tokens,
      CASE WHEN fills.qty_tokens > 0 THEN fills.usdc_amount / fills.qty_tokens ELSE 0 END as price
    FROM (
      SELECT
        any(token_id) as token_id,
        any(trade_time) as trade_time,
        any(side) as side,
        any(token_amount) / 1000000.0 as qty_tokens,
        any(usdc_amount) / 1000000.0 as usdc_amount
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}') AND is_deleted = 0
      GROUP BY event_id
    ) fills
    INNER JOIN pm_token_to_condition_map_v3 m ON fills.token_id = m.token_id_dec
    ORDER BY fills.trade_time
  `;

  const tradesResult = await clickhouse.query({ query: tradesQuery, format: 'JSONEachRow' });
  const trades = (await tradesResult.json()) as any[];

  console.log(`\nTotal trades: ${trades.length}`);

  // Get resolutions
  const resQuery = `SELECT condition_id, payout_numerators FROM pm_condition_resolutions`;
  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resRows = (await resResult.json()) as any[];
  const resolutions = new Map<string, number[]>();
  for (const r of resRows) {
    const payouts = r.payout_numerators ? JSON.parse(r.payout_numerators) : [];
    resolutions.set(r.condition_id.toLowerCase(), payouts);
  }

  // Process trades through position state machine
  const positions = new Map<string, PositionState>();

  for (const t of trades) {
    const key = `${t.condition_id}_${t.outcome_index}`;
    if (!positions.has(key)) {
      positions.set(key, { amount: 0, totalCost: 0, realizedPnl: 0 });
    }
    const pos = positions.get(key)!;
    const qty = Math.abs(Number(t.qty_tokens));
    const price = Number(t.price);

    if (t.side === 'buy') {
      // Add to position
      pos.totalCost += qty * price;
      pos.amount += qty;
    } else {
      // Sell: realize PnL using weighted average cost
      const avgCost = pos.amount > 0 ? pos.totalCost / pos.amount : 0;
      const sellQty = Math.min(qty, pos.amount);

      if (sellQty > 0 && avgCost > 0) {
        const proceeds = sellQty * price;
        const costBasis = sellQty * avgCost;
        const pnl = proceeds - costBasis;

        pos.realizedPnl += pnl;
        pos.amount -= sellQty;
        pos.totalCost -= costBasis;
      }
    }
  }

  // Apply resolutions
  let totalRealizedPnl = 0;
  let resolvedCount = 0;

  for (const [key, pos] of positions) {
    const [conditionId, outcomeStr] = key.split('_');
    const outcomeIndex = parseInt(outcomeStr, 10);

    // Apply resolution if there's remaining position
    if (pos.amount > 0.001) {
      const payouts = resolutions.get(conditionId.toLowerCase());
      if (payouts && payouts.length > outcomeIndex) {
        const payout = payouts[outcomeIndex];
        const avgCost = pos.amount > 0 ? pos.totalCost / pos.amount : 0;
        const proceeds = pos.amount * payout;
        const costBasis = pos.amount * avgCost;
        const resPnl = proceeds - costBasis;

        pos.realizedPnl += resPnl;
        resolvedCount++;
      }
    }

    totalRealizedPnl += pos.realizedPnl;
  }

  console.log('\n=== CLOB-ONLY V2 SUMMARY ===');
  console.log(`  Total Positions:    ${positions.size}`);
  console.log(`  Resolved:           ${resolvedCount}`);
  console.log(`  REALIZED PNL:       $${totalRealizedPnl.toLocaleString()}`);

  // Find top losers
  const sorted = [...positions.entries()].sort((a, b) => a[1].realizedPnl - b[1].realizedPnl);
  console.log('\n=== TOP 5 LOSERS ===');
  for (let i = 0; i < 5; i++) {
    const [key, pos] = sorted[i];
    console.log(`  ${key.substring(0, 20)}... PnL: $${pos.realizedPnl.toLocaleString()}`);
  }

  console.log('\n=== TOP 5 WINNERS ===');
  const winners = sorted.slice(-5).reverse();
  for (const [key, pos] of winners) {
    console.log(`  ${key.substring(0, 20)}... PnL: $${pos.realizedPnl.toLocaleString()}`);
  }

  console.log('\n=== COMPARISON ===');
  console.log(`  UI Expected:        $332,563`);
  console.log(`  V13 (NegRisk):      $-1,188,252`);
  console.log(`  CLOB-Only V2:       $${totalRealizedPnl.toLocaleString()}`);

  console.log('\n' + '='.repeat(80));
}

main().catch(console.error);
