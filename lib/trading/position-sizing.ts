/**
 * Position Sizing - Kelly Criterion and Risk Management
 *
 * Implements:
 * - Kelly Criterion calculator for optimal position sizing
 * - Portfolio heat checks (max % of capital in open positions)
 * - Position size limits (min/max)
 * - Risk/reward validation
 * - Drawdown protection
 *
 * @module lib/trading/position-sizing
 */

import type { PositionSizingConfig, PositionSizingResult } from './types';

// ============================================================================
// Position Sizing Calculator
// ============================================================================

export class PositionSizer {
  /**
   * Calculate optimal position size using Kelly Criterion
   *
   * Kelly Formula: f* = (bp - q) / b
   * where:
   *   f* = fraction of bankroll to bet
   *   b = odds received on bet (net profit / stake)
   *   p = probability of winning
   *   q = probability of losing (1 - p)
   *
   * For prediction markets:
   *   b = (1 - entry_price) / entry_price  for YES
   *   b = entry_price / (1 - entry_price)  for NO
   */
  calculateKellySize(
    config: PositionSizingConfig,
    entryPrice: number,
    winProbability: number,
    side: 'YES' | 'NO'
  ): PositionSizingResult {
    const constraints: string[] = [];

    // Calculate Kelly optimal
    const b = side === 'YES'
      ? (1 - entryPrice) / entryPrice  // Odds for YES
      : entryPrice / (1 - entryPrice); // Odds for NO

    const p = winProbability;
    const q = 1 - p;

    const kellyOptimal = (b * p - q) / b;

    // Apply Kelly fraction (typically 25-50% of full Kelly)
    const fractionalKelly = kellyOptimal * config.kelly_fraction;

    // Calculate dollar amount
    let recommendedUsd = config.portfolio_size_usd * fractionalKelly;

    // Apply constraints
    // 1. Max position size
    if (recommendedUsd > config.max_bet_usd) {
      recommendedUsd = config.max_bet_usd;
      constraints.push(`Capped at max_bet_usd ($${config.max_bet_usd})`);
    }

    // 2. Min position size
    if (recommendedUsd < config.min_bet_usd) {
      if (kellyOptimal > 0) {
        recommendedUsd = config.min_bet_usd;
        constraints.push(`Increased to min_bet_usd ($${config.min_bet_usd})`);
      } else {
        recommendedUsd = 0;
        constraints.push('Kelly optimal is negative, skip trade');
      }
    }

    // 3. Max position as % of portfolio
    const maxPositionUsd = config.portfolio_size_usd * config.max_position_pct;
    if (recommendedUsd > maxPositionUsd) {
      recommendedUsd = maxPositionUsd;
      constraints.push(`Capped at max_position_pct (${(config.max_position_pct * 100).toFixed(1)}%)`);
    }

    // 4. Portfolio heat check
    const portfolioHeatCheck = this.checkPortfolioHeat(
      config,
      recommendedUsd
    );

    if (portfolioHeatCheck.current_heat + recommendedUsd / config.portfolio_size_usd > config.max_portfolio_heat) {
      const maxAllowed = (config.max_portfolio_heat - portfolioHeatCheck.current_heat) * config.portfolio_size_usd;
      if (maxAllowed < config.min_bet_usd) {
        recommendedUsd = 0;
        constraints.push('Portfolio heat limit reached');
      } else {
        recommendedUsd = Math.min(recommendedUsd, maxAllowed);
        constraints.push(`Reduced due to portfolio heat (${(portfolioHeatCheck.current_heat * 100).toFixed(1)}%)`);
      }
    }

    // 5. Drawdown protection
    if (config.drawdown_protection?.enabled) {
      const drawdown = this.calculateDrawdown(config);
      if (drawdown >= config.drawdown_protection.drawdown_threshold) {
        recommendedUsd *= config.drawdown_protection.size_reduction;
        constraints.push(`Reduced ${((1 - config.drawdown_protection.size_reduction) * 100).toFixed(0)}% due to drawdown`);
      }
    }

    // Calculate shares
    const recommendedShares = side === 'YES'
      ? recommendedUsd / entryPrice
      : recommendedUsd / (1 - entryPrice);

    // Build reasoning
    const reasoning = this.buildReasoning(
      kellyOptimal,
      fractionalKelly,
      winProbability,
      b,
      recommendedUsd,
      constraints
    );

    return {
      recommended_usd: Math.round(recommendedUsd * 100) / 100,
      recommended_shares: Math.round(recommendedShares * 100) / 100,
      reasoning,
      constraints_applied: constraints,
      kelly_optimal: kellyOptimal,
      fractional_kelly: fractionalKelly,
      portfolio_heat_check: portfolioHeatCheck,
    };
  }

  /**
   * Simple position sizing based on fixed percentage
   * (Used when Kelly calculation not applicable)
   */
  calculateFixedPercentage(
    config: PositionSizingConfig,
    percentage: number
  ): PositionSizingResult {
    const constraints: string[] = [];
    let recommendedUsd = config.portfolio_size_usd * (percentage / 100);

    // Apply max/min constraints
    if (recommendedUsd > config.max_bet_usd) {
      recommendedUsd = config.max_bet_usd;
      constraints.push(`Capped at max_bet_usd ($${config.max_bet_usd})`);
    }

    if (recommendedUsd < config.min_bet_usd) {
      recommendedUsd = config.min_bet_usd;
      constraints.push(`Increased to min_bet_usd ($${config.min_bet_usd})`);
    }

    return {
      recommended_usd: Math.round(recommendedUsd * 100) / 100,
      recommended_shares: 0, // Caller must calculate based on price
      reasoning: `Fixed ${percentage}% of portfolio`,
      constraints_applied: constraints,
      kelly_optimal: 0,
      fractional_kelly: 0,
      portfolio_heat_check: {
        current_heat: 0,
        remaining_capacity: config.max_portfolio_heat,
      },
    };
  }

  /**
   * Check portfolio heat (% of capital currently in open positions)
   */
  private checkPortfolioHeat(
    config: PositionSizingConfig,
    proposedPositionUsd: number
  ): { current_heat: number; remaining_capacity: number } {
    // TODO: Query actual open positions from database
    // For now, assume 0 heat
    const current_heat = 0;
    const remaining_capacity = config.max_portfolio_heat - current_heat;

    return {
      current_heat,
      remaining_capacity,
    };
  }

  /**
   * Calculate current drawdown from peak
   */
  private calculateDrawdown(config: PositionSizingConfig): number {
    // TODO: Query strategy performance to get peak balance
    // For now, assume no drawdown
    return 0;
  }

  /**
   * Build human-readable reasoning
   */
  private buildReasoning(
    kellyOptimal: number,
    fractionalKelly: number,
    winProbability: number,
    odds: number,
    recommendedUsd: number,
    constraints: string[]
  ): string {
    const parts: string[] = [];

    parts.push(`Win probability: ${(winProbability * 100).toFixed(1)}%`);
    parts.push(`Odds: ${odds.toFixed(2)}:1`);
    parts.push(`Kelly optimal: ${(kellyOptimal * 100).toFixed(1)}% of bankroll`);
    parts.push(`Fractional Kelly: ${(fractionalKelly * 100).toFixed(1)}% of bankroll`);

    if (constraints.length > 0) {
      parts.push(`Constraints: ${constraints.join(', ')}`);
    }

    parts.push(`Final size: $${recommendedUsd.toFixed(2)}`);

    return parts.join(' | ');
  }

  /**
   * Validate if position meets risk/reward requirements
   */
  validateRiskReward(
    entryPrice: number,
    side: 'YES' | 'NO',
    minRiskReward: number
  ): { valid: boolean; ratio: number; reason?: string } {
    // Calculate potential profit vs potential loss
    const potentialProfit = side === 'YES'
      ? (1 - entryPrice)  // If YES wins, gain (1 - entry_price) per share
      : entryPrice;       // If NO wins, gain entry_price per share

    const potentialLoss = side === 'YES'
      ? entryPrice        // If YES loses, lose entry_price per share
      : (1 - entryPrice); // If NO loses, lose (1 - entry_price) per share

    const ratio = potentialProfit / potentialLoss;

    if (ratio < minRiskReward) {
      return {
        valid: false,
        ratio,
        reason: `Risk/reward ratio ${ratio.toFixed(2)}:1 below minimum ${minRiskReward}:1`,
      };
    }

    return {
      valid: true,
      ratio,
    };
  }
}

// Export singleton
export const positionSizer = new PositionSizer();
