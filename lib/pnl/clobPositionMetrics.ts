/**
 * CLOB Position Metrics Calculator
 *
 * Calculates per-position trading metrics for CLOB-only wallets.
 * Works for all wallet types: maker-heavy, taker-heavy, and mixed.
 *
 * KEY INSIGHT: Different wallet types need different PnL formulas:
 * - Taker-heavy: Position-based formula (proceeds + remaining×payout - cost)
 * - Maker-heavy: Spread-based formula (sell_usdc - buy_usdc + payout)
 *
 * The taker_sell_ratio determines which to use:
 * - ratio > 1.0: Taker sells exceed buyable tokens → use maker-only approach
 * - ratio ≤ 1.0: Taker sells covered by buys → use position-based approach
 *
 * This matches CCR-v6's automatic method selection for consistent PnL.
 */

import { clickhouse } from '../clickhouse/client';

export interface PositionMetrics {
  // Position counts
  total_positions: number;
  resolved_positions: number;
  open_positions: number;

  // Win/Loss
  wins: number;
  losses: number;
  breakeven: number;
  win_rate: number;

  // PnL metrics
  total_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  total_win_pnl: number;
  total_loss_pnl: number;
  avg_win: number;
  avg_loss: number;

  // Risk metrics
  payoff_ratio: number;
  expectancy: number;

  // Capital metrics
  total_cost: number;
  total_proceeds: number;
  roi_percent: number;

  // Position details (for analysis)
  largest_win: number;
  largest_loss: number;

  // Debug info
  missing_resolution_count: number;
  missing_token_map_count: number;
}

export interface ClobMetricsResult {
  wallet: string;
  method: 'clob-position';
  pnl_method: 'position-based' | 'maker-spread';  // Which formula was used for total_pnl
  taker_sell_ratio: number;  // Detection signal for wallet type
  metrics: PositionMetrics;
  positions: PositionDetail[];
}

export interface PositionDetail {
  token_id: string;
  condition_id: string | null;
  outcome_index: number;
  cost_usd: number;
  proceeds_usd: number;
  tokens_bought: number;
  tokens_sold: number;
  tokens_remaining: number;
  payout_share: number;
  is_resolved: boolean;
  pnl: number;
  roi_percent: number;
  result: 'win' | 'loss' | 'breakeven' | 'open';
}

/**
 * Calculate per-position metrics for a CLOB wallet.
 *
 * @param wallet - Wallet address
 * @param minCostFilter - Minimum position cost to include (filters dust)
 */
export async function computeClobPositionMetrics(
  wallet: string,
  minCostFilter: number = 1
): Promise<ClobMetricsResult> {
  const walletLower = wallet.toLowerCase();

  // Step 1: Get wallet type detection signal (matches CCR-v6 logic)
  const walletTypeQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(side) as side,
        any(role) as role,
        any(toFloat64(usdc_amount)) / 1e6 as usdc,
        any(toFloat64(token_amount)) / 1e6 as tokens
      FROM pm_trader_events_v3
      WHERE trader_wallet = '${walletLower}'
       
      GROUP BY event_id
    )
    SELECT
      sumIf(usdc, side = 'buy') as total_buy_usdc,
      sumIf(usdc, side = 'sell') as total_sell_usdc,
      sumIf(usdc, side = 'buy' AND role = 'maker') as maker_buy_usdc,
      sumIf(usdc, side = 'sell' AND role = 'maker') as maker_sell_usdc,
      sumIf(tokens, side = 'buy') as total_buy_tokens,
      sumIf(tokens, side = 'sell' AND role = 'taker') as taker_sell_tokens
    FROM deduped
  `;

  const walletTypeResult = await clickhouse.query({ query: walletTypeQuery, format: 'JSONEachRow' });
  const walletStats = (await walletTypeResult.json() as any[])[0] || {};

  // Calculate taker_sell_ratio to determine wallet type
  const totalBuyTokens = walletStats.total_buy_tokens || 0;
  const takerSellTokens = walletStats.taker_sell_tokens || 0;
  const takerSellRatio = takerSellTokens / (totalBuyTokens + 1); // +1 to avoid division by zero
  const useMakerSpread = takerSellRatio > 1.0;

  // Step 2: Get payout redemptions for maker-spread formula
  const payoutQuery = `
    SELECT sum(toFloat64OrZero(amount_or_payout)) / 1e6 as payout_usdc
    FROM pm_ctf_events
    WHERE user_address = '${walletLower}'
      AND event_type = 'PayoutRedemption'
      AND is_deleted = 0
  `;

  const payoutResult = await clickhouse.query({ query: payoutQuery, format: 'JSONEachRow' });
  const payoutData = (await payoutResult.json() as any[])[0] || {};
  const payoutUsdc = payoutData.payout_usdc || 0;

  // Step 3: Get all positions with resolution data
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(toFloat64(usdc_amount)) / 1e6 as usdc,
        any(toFloat64(token_amount)) / 1e6 as tokens
      FROM pm_trader_events_v3
      WHERE trader_wallet = '${walletLower}'
       
      GROUP BY event_id
    ),
    positions AS (
      SELECT
        d.token_id,
        m.condition_id,
        m.outcome_index,
        sumIf(d.usdc, d.side = 'buy') as cost_usd,
        sumIf(d.usdc, d.side = 'sell') as proceeds_usd,
        sumIf(d.tokens, d.side = 'buy') as tokens_bought,
        sumIf(d.tokens, d.side = 'sell') as tokens_sold
      FROM deduped d
      LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
      GROUP BY d.token_id, m.condition_id, m.outcome_index
      HAVING cost_usd > ${minCostFilter}
    )
    SELECT
      p.token_id,
      p.condition_id,
      p.outcome_index,
      p.cost_usd,
      p.proceeds_usd,
      p.tokens_bought,
      p.tokens_sold,
      p.tokens_bought - p.tokens_sold as tokens_remaining,
      r.payout_numerators,
      if(r.condition_id IS NOT NULL, 1, 0) as is_resolved
    FROM positions p
    LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id
    ORDER BY p.cost_usd DESC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rawPositions = await result.json() as any[];

  // Process positions and calculate metrics
  const positions: PositionDetail[] = [];
  let wins = 0, losses = 0, breakeven = 0, open = 0;
  let totalPnl = 0, realizedPnl = 0, unrealizedPnl = 0;
  let winPnl = 0, lossPnl = 0;
  let totalCost = 0, totalProceeds = 0;
  let largestWin = 0, largestLoss = 0;
  let missingResolution = 0, missingTokenMap = 0;

  for (const p of rawPositions) {
    const cost = +p.cost_usd || 0;
    const proceeds = +p.proceeds_usd || 0;
    const remaining = +p.tokens_remaining || 0;
    const isResolved = p.is_resolved === 1;
    const outcomeIdx = p.outcome_index ?? 0;

    // Track missing data
    if (!p.condition_id) {
      missingTokenMap++;
    } else if (!isResolved && p.condition_id) {
      missingResolution++;
    }

    // Parse payout - format is '[1,0]' or '[0,1]'
    let payoutShare = 0;
    if (isResolved && p.payout_numerators) {
      try {
        const payouts = JSON.parse(p.payout_numerators);
        payoutShare = payouts[outcomeIdx] || 0;
      } catch {
        // Invalid payout format
      }
    }

    totalCost += cost;
    totalProceeds += proceeds;

    // Calculate PnL
    let pnl: number;
    let result: 'win' | 'loss' | 'breakeven' | 'open';

    if (!isResolved) {
      // Open position - estimate unrealized PnL
      // For now, just use proceeds - cost (assumes tokens at 0)
      // TODO: Could fetch current mark prices for better estimate
      pnl = proceeds - cost;
      unrealizedPnl += pnl;
      result = 'open';
      open++;
    } else {
      // Resolved: proceeds + (remaining × payout) - cost
      pnl = proceeds + (remaining * payoutShare) - cost;
      realizedPnl += pnl;

      if (pnl > 0.01) {
        result = 'win';
        wins++;
        winPnl += pnl;
        if (pnl > largestWin) largestWin = pnl;
      } else if (pnl < -0.01) {
        result = 'loss';
        losses++;
        lossPnl += pnl;
        if (pnl < largestLoss) largestLoss = pnl;
      } else {
        result = 'breakeven';
        breakeven++;
      }
    }

    totalPnl += pnl;

    positions.push({
      token_id: p.token_id,
      condition_id: p.condition_id,
      outcome_index: outcomeIdx,
      cost_usd: cost,
      proceeds_usd: proceeds,
      tokens_bought: +p.tokens_bought || 0,
      tokens_sold: +p.tokens_sold || 0,
      tokens_remaining: remaining,
      payout_share: payoutShare,
      is_resolved: isResolved,
      pnl,
      roi_percent: cost > 0 ? (pnl / cost) * 100 : 0,
      result,
    });
  }

  // Calculate aggregate metrics
  const resolved = wins + losses + breakeven;
  const winRate = resolved > 0 ? wins / resolved : 0;
  const avgWin = wins > 0 ? winPnl / wins : 0;
  const avgLoss = losses > 0 ? lossPnl / losses : 0;
  const payoffRatio = losses > 0 && avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;
  const expectancy = resolved > 0
    ? (winRate * avgWin) + ((1 - winRate) * avgLoss)
    : 0;

  // CRITICAL: Use the correct PnL formula based on wallet type
  // For maker-heavy wallets: spread formula works (CCR-v6 proven: 1.59% error)
  // For taker-heavy wallets: position-based formula works (5.9% error)
  let finalTotalPnl: number;
  let pnlMethod: 'position-based' | 'maker-spread';

  if (useMakerSpread) {
    // Maker-spread formula: sell_usdc - buy_usdc + payout
    // This captures spread profits that position-based misses
    finalTotalPnl = (walletStats.maker_sell_usdc || 0) - (walletStats.maker_buy_usdc || 0) + payoutUsdc;
    pnlMethod = 'maker-spread';
  } else {
    // Position-based formula: sum of per-position PnL
    finalTotalPnl = totalPnl;
    pnlMethod = 'position-based';
  }

  const roi = totalCost > 0 ? (finalTotalPnl / totalCost) * 100 : 0;

  return {
    wallet: walletLower,
    method: 'clob-position',
    pnl_method: pnlMethod,
    taker_sell_ratio: takerSellRatio,
    metrics: {
      total_positions: positions.length,
      resolved_positions: resolved,
      open_positions: open,
      wins,
      losses,
      breakeven,
      win_rate: winRate,
      total_pnl: finalTotalPnl,
      realized_pnl: realizedPnl,
      unrealized_pnl: unrealizedPnl,
      total_win_pnl: winPnl,
      total_loss_pnl: lossPnl,
      avg_win: avgWin,
      avg_loss: avgLoss,
      payoff_ratio: payoffRatio,
      expectancy,
      total_cost: totalCost,
      total_proceeds: totalProceeds,
      roi_percent: roi,
      largest_win: largestWin,
      largest_loss: largestLoss,
      missing_resolution_count: missingResolution,
      missing_token_map_count: missingTokenMap,
    },
    positions,
  };
}

/**
 * Get a summary string for display.
 */
export function formatMetricsSummary(result: ClobMetricsResult): string {
  const m = result.metrics;
  const lines = [
    `Wallet: ${result.wallet}`,
    ``,
    `Position Summary:`,
    `  Total: ${m.total_positions} (${m.resolved_positions} resolved, ${m.open_positions} open)`,
    `  Wins: ${m.wins}, Losses: ${m.losses}, Breakeven: ${m.breakeven}`,
    `  Win Rate: ${(m.win_rate * 100).toFixed(1)}%`,
    ``,
    `PnL Breakdown:`,
    `  Total PnL: $${m.total_pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
    `  Realized: $${m.realized_pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
    `  Unrealized: $${m.unrealized_pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
    ``,
    `Win/Loss Analysis:`,
    `  Avg Win: $${m.avg_win.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
    `  Avg Loss: $${m.avg_loss.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
    `  Payoff Ratio: ${m.payoff_ratio.toFixed(2)}`,
    `  Expectancy: $${m.expectancy.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
    ``,
    `Capital:`,
    `  Total Cost: $${m.total_cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
    `  Total Proceeds: $${m.total_proceeds.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
    `  ROI: ${m.roi_percent.toFixed(1)}%`,
    ``,
    `Extremes:`,
    `  Largest Win: $${m.largest_win.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
    `  Largest Loss: $${m.largest_loss.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
  ];

  if (m.missing_token_map_count > 0 || m.missing_resolution_count > 0) {
    lines.push(``);
    lines.push(`Data Quality:`);
    if (m.missing_token_map_count > 0) {
      lines.push(`  Missing token mapping: ${m.missing_token_map_count} positions`);
    }
    if (m.missing_resolution_count > 0) {
      lines.push(`  Missing resolution: ${m.missing_resolution_count} positions`);
    }
  }

  return lines.join('\n');
}
