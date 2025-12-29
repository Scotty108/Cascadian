/**
 * Test CLOB-Only Approach
 *
 * Instead of using NegRisk cost basis, use CLOB prices only.
 * This ignores the $0.50 conceptual cost basis entirely.
 */

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

async function main() {
  console.log('='.repeat(80));
  console.log('TEST: CLOB-ONLY PNL CALCULATION');
  console.log('='.repeat(80));

  // Get all CLOB trades with proper deduplication
  const tradesQuery = `
    SELECT
      m.condition_id,
      m.outcome_index,
      any(fills.side) as side,
      sum(fills.qty_tokens) as qty,
      sum(fills.usdc_amount) as usdc
    FROM (
      SELECT
        any(token_id) as token_id,
        any(side) as side,
        any(token_amount) / 1000000.0 as qty_tokens,
        any(usdc_amount) / 1000000.0 as usdc_amount
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}') AND is_deleted = 0
      GROUP BY event_id
    ) fills
    INNER JOIN pm_token_to_condition_map_v3 m ON fills.token_id = m.token_id_dec
    GROUP BY m.condition_id, m.outcome_index, fills.side
  `;

  const tradesResult = await clickhouse.query({ query: tradesQuery, format: 'JSONEachRow' });
  const trades = (await tradesResult.json()) as any[];

  // Aggregate by position
  const positions = new Map<string, { buys: { qty: number; cost: number }; sells: { qty: number; proceeds: number } }>();

  for (const t of trades) {
    const key = `${t.condition_id}_${t.outcome_index}`;
    if (!positions.has(key)) {
      positions.set(key, { buys: { qty: 0, cost: 0 }, sells: { qty: 0, proceeds: 0 } });
    }
    const pos = positions.get(key)!;
    if (t.side === 'buy') {
      pos.buys.qty += Number(t.qty);
      pos.buys.cost += Number(t.usdc);
    } else {
      pos.sells.qty += Number(t.qty);
      pos.sells.proceeds += Number(t.usdc);
    }
  }

  // Get resolutions
  const resQuery = `SELECT condition_id, payout_numerators FROM pm_condition_resolutions`;
  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resRows = (await resResult.json()) as any[];
  const resolutions = new Map<string, number[]>();
  for (const r of resRows) {
    const payouts = r.payout_numerators ? JSON.parse(r.payout_numerators) : [];
    resolutions.set(r.condition_id.toLowerCase(), payouts);
  }

  // Calculate PnL
  let totalRealizedPnl = 0;
  let totalBuyCost = 0;
  let totalSellProceeds = 0;
  let totalResolutionProceeds = 0;

  for (const [key, pos] of positions) {
    const [conditionId, outcomeStr] = key.split('_');
    const outcomeIndex = parseInt(outcomeStr, 10);

    const remainingQty = pos.buys.qty - pos.sells.qty;
    const avgCost = pos.buys.qty > 0 ? pos.buys.cost / pos.buys.qty : 0;

    // Trading PnL (sells - pro-rata cost)
    const sellCostBasis = (pos.sells.qty / pos.buys.qty) * pos.buys.cost;
    const tradingPnl = pos.sells.proceeds - (pos.buys.qty > 0 ? sellCostBasis : 0);

    // Resolution PnL
    let resolutionPnl = 0;
    const payouts = resolutions.get(conditionId);
    if (payouts && payouts.length > outcomeIndex && remainingQty > 0) {
      const payout = payouts[outcomeIndex];
      const resolutionProceeds = remainingQty * payout;
      const resolutionCost = (remainingQty / pos.buys.qty) * pos.buys.cost;
      resolutionPnl = resolutionProceeds - resolutionCost;
      totalResolutionProceeds += resolutionProceeds;
    }

    totalRealizedPnl += tradingPnl + resolutionPnl;
    totalBuyCost += pos.buys.cost;
    totalSellProceeds += pos.sells.proceeds;
  }

  console.log('\n=== CLOB-ONLY SUMMARY ===');
  console.log(`  Total Positions:        ${positions.size}`);
  console.log(`  Total Buy Cost:         $${totalBuyCost.toLocaleString()}`);
  console.log(`  Total Sell Proceeds:    $${totalSellProceeds.toLocaleString()}`);
  console.log(`  Total Resolution:       $${totalResolutionProceeds.toLocaleString()}`);
  console.log(`  REALIZED PNL:           $${totalRealizedPnl.toLocaleString()}`);

  console.log('\n=== COMPARISON ===');
  console.log(`  UI Expected:            $332,563`);
  console.log(`  V13 (with NegRisk):     $-1,188,252`);
  console.log(`  CLOB-Only:              $${totalRealizedPnl.toLocaleString()}`);

  console.log('\n' + '='.repeat(80));
}

main().catch(console.error);
