/**
 * Static Position Analysis - Ground Truth Calculator
 *
 * Computes the mathematically correct PnL for a single position
 * using raw ClickHouse queries with proper deduplication.
 */

import { clickhouse } from '../clickhouse/client';

export interface StaticPositionSummary {
  wallet: string;
  conditionId: string;
  outcomeIndex: number;
  totalQtyAcquired: number;
  totalCost: number;
  totalQtySold: number;
  totalProceeds: number;
  remainingQty: number;
  payoutPerToken: number;
  impliedPnlWithResolution: number;
  // Breakdown for debugging
  clobBuyQty: number;
  clobBuyCost: number;
  clobSellQty: number;
  clobSellProceeds: number;
  negriskQty: number;
  negriskCost: number;
}

export async function computeStaticPositionSummary(
  wallet: string,
  conditionId: string,
  outcomeIndex: number
): Promise<StaticPositionSummary> {
  // 1. Get CLOB buys with deduplication
  const clobBuysQuery = await clickhouse.query({
    query: `
      SELECT
        sum(usdc) as total_usdc,
        sum(tokens) as total_tokens
      FROM (
        SELECT
          any(usdc_amount) / 1000000.0 as usdc,
          any(token_amount) / 1000000.0 as tokens
        FROM pm_trader_events_v2 t
        WHERE lower(t.trader_wallet) = lower('${wallet}')
          AND t.is_deleted = 0
          AND t.side = 'buy'
          AND t.token_id IN (
            SELECT token_id_dec
            FROM pm_token_to_condition_map_v3
            WHERE condition_id = '${conditionId}' AND outcome_index = ${outcomeIndex}
          )
        GROUP BY event_id
      )
    `,
    format: 'JSONEachRow',
  });
  const clobBuysRows = (await clobBuysQuery.json()) as any[];
  const clobBuyQty = Number(clobBuysRows[0]?.total_tokens || 0);
  const clobBuyCost = Number(clobBuysRows[0]?.total_usdc || 0);

  // 2. Get CLOB sells with deduplication
  const clobSellsQuery = await clickhouse.query({
    query: `
      SELECT
        sum(usdc) as total_usdc,
        sum(tokens) as total_tokens
      FROM (
        SELECT
          any(usdc_amount) / 1000000.0 as usdc,
          any(token_amount) / 1000000.0 as tokens
        FROM pm_trader_events_v2 t
        WHERE lower(t.trader_wallet) = lower('${wallet}')
          AND t.is_deleted = 0
          AND t.side = 'sell'
          AND t.token_id IN (
            SELECT token_id_dec
            FROM pm_token_to_condition_map_v3
            WHERE condition_id = '${conditionId}' AND outcome_index = ${outcomeIndex}
          )
        GROUP BY event_id
      )
    `,
    format: 'JSONEachRow',
  });
  const clobSellsRows = (await clobSellsQuery.json()) as any[];
  const clobSellQty = Number(clobSellsRows[0]?.total_tokens || 0);
  const clobSellProceeds = Number(clobSellsRows[0]?.total_usdc || 0);

  // 3. Get NegRisk acquisitions
  const negriskQuery = await clickhouse.query({
    query: `
      SELECT
        sum(n.shares) as total_tokens,
        sum(n.shares * n.cost_basis_per_share) as total_cost
      FROM vw_negrisk_conversions n
      INNER JOIN pm_token_to_condition_map_v3 m
        ON reinterpretAsUInt256(reverse(unhex(substring(n.token_id_hex, 3)))) = toUInt256(m.token_id_dec)
      WHERE lower(n.wallet) = lower('${wallet}')
        AND m.condition_id = '${conditionId}'
        AND m.outcome_index = ${outcomeIndex}
    `,
    format: 'JSONEachRow',
  });
  const negriskRows = (await negriskQuery.json()) as any[];
  const negriskQty = Number(negriskRows[0]?.total_tokens || 0);
  const negriskCost = Number(negriskRows[0]?.total_cost || 0);

  // 4. Get resolution payout
  const resolutionQuery = await clickhouse.query({
    query: `
      SELECT payout_numerators
      FROM pm_condition_resolutions
      WHERE condition_id = '${conditionId}'
      LIMIT 1
    `,
    format: 'JSONEachRow',
  });
  const resolutionRows = (await resolutionQuery.json()) as any[];
  let payoutPerToken = 0;
  if (resolutionRows.length > 0 && resolutionRows[0].payout_numerators) {
    const payouts = JSON.parse(resolutionRows[0].payout_numerators);
    payoutPerToken = payouts[outcomeIndex] ?? 0;
  }

  // 5. Calculate totals
  const totalQtyAcquired = clobBuyQty + negriskQty;
  const totalCost = clobBuyCost + negriskCost;
  const totalQtySold = clobSellQty;
  const totalProceeds = clobSellProceeds;
  const remainingQty = totalQtyAcquired - totalQtySold;

  // 6. Calculate implied PnL with resolution
  // PnL = totalProceeds + (remainingQty * payoutPerToken) - totalCost
  const impliedPnlWithResolution = totalProceeds + remainingQty * payoutPerToken - totalCost;

  return {
    wallet,
    conditionId,
    outcomeIndex,
    totalQtyAcquired,
    totalCost,
    totalQtySold,
    totalProceeds,
    remainingQty,
    payoutPerToken,
    impliedPnlWithResolution,
    clobBuyQty,
    clobBuyCost,
    clobSellQty,
    clobSellProceeds,
    negriskQty,
    negriskCost,
  };
}
