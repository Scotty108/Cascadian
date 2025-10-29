/**
 * DecisionEngine - Copy Trade Decision Logic
 *
 * Implements 7-step decision algorithm:
 * 1. Category filter - does market category match strategy preferences?
 * 2. OWRR threshold - does OWRR meet minimum threshold for this side?
 * 3. OWRR confidence - is there sufficient data to trust the signal?
 * 4. Position limits - would this exceed max positions?
 * 5. Capital availability - is there enough capital?
 * 6. Position sizing - calculate appropriate position size
 * 7. Minimum size validation - is position large enough to be worth it?
 *
 * All decisions include human-readable reasoning for transparency.
 *
 * @module lib/trading/decision-engine
 */

import type { OWRRResult } from '@/lib/metrics/owrr';
import type { CopyDecision, TradeSide } from './types';
import { createClient } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

interface Strategy {
  strategy_id: string;
  name: string;
  settings: {
    current_balance_usd: number;
    max_position_size_usd: number;
    max_positions: number;
    risk_per_trade_percent: number;
    copy_trading_config?: {
      enabled: boolean;
      owrr_threshold_yes: number;
      owrr_threshold_no: number;
      min_owrr_confidence: string;
      tracked_categories: string[];
    };
  };
}

interface Trade {
  trade_id: string;
  wallet_address: string;
  market_id: string;
  side: TradeSide;
  entry_price: number;
  shares: number;
  usd_value: number;
  timestamp: Date;
  category?: string;
}

// ============================================================================
// DecisionEngine Class
// ============================================================================

export class DecisionEngine {
  private supabase: ReturnType<typeof createClient>;

  constructor() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Main decision method - evaluate whether to copy a trade
   */
  async decide(
    strategy: Strategy,
    trade: Trade,
    owrr: OWRRResult
  ): Promise<CopyDecision> {
    console.log(`[DecisionEngine] Evaluating trade for ${strategy.name}:`, {
      market: trade.market_id,
      side: trade.side,
      owrr: owrr.slider,
    });

    const factors: Record<string, any> = {};

    // Rule 1: Category filter
    if (trade.category) {
      const categoryMatch = this.matchesCategory(strategy, trade.category);
      factors.category_match = categoryMatch;

      if (!categoryMatch) {
        return {
          decision: 'skip',
          reason: `Category '${trade.category}' not tracked by strategy`,
          factors,
        };
      }
    }

    // Rule 2: OWRR threshold
    const threshold = this.getOWRRThreshold(strategy, trade.side);
    const meetsThreshold = this.meetsOWRRThreshold(owrr, trade.side, threshold);
    factors.owrr = owrr.slider;
    factors.owrr_threshold = threshold;
    factors.meets_threshold = meetsThreshold;

    if (!meetsThreshold) {
      return {
        decision: 'skip',
        reason: `OWRR ${owrr.slider} does not meet ${trade.side} threshold ${threshold}`,
        factors,
      };
    }

    // Rule 3: OWRR confidence
    factors.owrr_confidence = owrr.confidence;

    if (owrr.confidence === 'insufficient_data' || owrr.confidence === 'low') {
      return {
        decision: 'skip',
        reason: `OWRR confidence too low: ${owrr.confidence}`,
        factors,
      };
    }

    // Rule 4: Position limits
    const openPositions = await this.getOpenPositionsCount(strategy.strategy_id);
    factors.open_positions = openPositions;
    factors.max_positions = strategy.settings.max_positions;

    if (openPositions >= strategy.settings.max_positions) {
      return {
        decision: 'skip',
        reason: `Max positions reached (${openPositions}/${strategy.settings.max_positions})`,
        factors,
      };
    }

    // Rule 5: Capital availability
    const availableCapital = strategy.settings.current_balance_usd;
    const minCapital = strategy.settings.max_position_size_usd * 0.1; // Need at least 10% of max
    factors.available_capital = availableCapital;
    factors.min_capital = minCapital;

    if (availableCapital < minCapital) {
      return {
        decision: 'skip',
        reason: `Insufficient capital ($${availableCapital.toFixed(2)} available, need $${minCapital.toFixed(2)})`,
        factors,
      };
    }

    // Rule 6: Calculate position size
    const positionSize = this.calculatePositionSize(strategy, trade, owrr);
    factors.position_size_usd = positionSize;

    // Rule 7: Validate position size
    const minPositionSize = 10; // $10 minimum
    if (positionSize < minPositionSize) {
      return {
        decision: 'skip',
        reason: `Position size too small ($${positionSize.toFixed(2)}, min $${minPositionSize})`,
        factors,
      };
    }

    // Cap at available capital
    if (positionSize > availableCapital) {
      return {
        decision: 'skip',
        reason: `Position size ($${positionSize.toFixed(2)}) exceeds available capital ($${availableCapital.toFixed(2)})`,
        factors,
      };
    }

    // Calculate position size multiplier
    const multiplier = positionSize / trade.usd_value;
    factors.position_size_multiplier = multiplier;

    // All checks passed - COPY the trade
    const confidence = this.calculateConfidence(owrr);
    factors.confidence = confidence;

    // Determine if we should reduce position size
    if (owrr.confidence === 'medium' && multiplier > 0.5) {
      // Reduce position size for medium confidence signals
      const reducedSize = positionSize * 0.5;
      factors.position_size_usd = reducedSize;
      factors.position_size_multiplier = reducedSize / trade.usd_value;

      return {
        decision: 'copy_reduced',
        reason: `OWRR ${owrr.slider}, confidence ${owrr.confidence} (reduced position size)`,
        factors,
        position_size_multiplier: reducedSize / trade.usd_value,
      };
    }

    return {
      decision: 'copy',
      reason: `OWRR ${owrr.slider}, confidence ${owrr.confidence}`,
      factors,
      position_size_multiplier: multiplier,
    };
  }

  /**
   * Check if market category matches strategy preferences
   */
  private matchesCategory(strategy: Strategy, category: string): boolean {
    const config = strategy.settings.copy_trading_config;

    if (!config || !config.tracked_categories) {
      return true; // No category filter, accept all
    }

    return config.tracked_categories.includes(category);
  }

  /**
   * Get OWRR threshold for trade side
   *
   * For YES trades: require OWRR > 60 (smart money favors YES)
   * For NO trades: require OWRR < 40 (smart money favors NO)
   */
  private getOWRRThreshold(strategy: Strategy, side: TradeSide): number {
    const config = strategy.settings.copy_trading_config;

    if (side === 'YES') {
      return config?.owrr_threshold_yes || 60;
    } else {
      return config?.owrr_threshold_no || 40;
    }
  }

  /**
   * Check if OWRR meets threshold for this trade side
   */
  private meetsOWRRThreshold(
    owrr: OWRRResult,
    side: TradeSide,
    threshold: number
  ): boolean {
    if (side === 'YES') {
      // For YES trades, OWRR slider must be >= threshold
      return owrr.slider >= threshold;
    } else {
      // For NO trades, OWRR slider must be <= threshold
      return owrr.slider <= threshold;
    }
  }

  /**
   * Get count of open positions for a strategy
   */
  private async getOpenPositionsCount(strategyId: string): Promise<number> {
    try {
      const { count, error } = await this.supabase
        .from('copy_trades')
        .select('*', { count: 'exact', head: true })
        .eq('strategy_id', strategyId)
        .eq('status', 'open');

      if (error) {
        console.error('[DecisionEngine] Error counting positions:', error);
        return 0;
      }

      return count || 0;
    } catch (error) {
      console.error('[DecisionEngine] Error counting positions:', error);
      return 0;
    }
  }

  /**
   * Calculate position size based on:
   * - Strategy settings (max_position_size_usd, risk_per_trade_percent)
   * - OWRR strength (higher OWRR = larger position)
   * - Available capital
   */
  private calculatePositionSize(
    strategy: Strategy,
    trade: Trade,
    owrr: OWRRResult
  ): number {
    const settings = strategy.settings;

    // Base position size from risk_per_trade_percent
    const baseSize = settings.current_balance_usd * (settings.risk_per_trade_percent / 100);

    // Scale by OWRR strength (0.5 to 1.0 multiplier)
    const owrrStrength = this.getOWRRStrength(owrr, trade.side);
    const scaledSize = baseSize * (0.5 + owrrStrength * 0.5); // Min 50%, max 100% of base

    // Cap at max_position_size_usd
    const cappedSize = Math.min(scaledSize, settings.max_position_size_usd);

    // Cap at available capital
    const finalSize = Math.min(cappedSize, settings.current_balance_usd);

    return Math.round(finalSize * 100) / 100; // Round to 2 decimals
  }

  /**
   * Calculate OWRR strength (0.0 - 1.0)
   *
   * For YES trades: strength = (owrr - 0.5) / 0.5
   *   - OWRR 0.5 (50) → strength 0.0
   *   - OWRR 0.75 (75) → strength 0.5
   *   - OWRR 1.0 (100) → strength 1.0
   *
   * For NO trades: strength = (0.5 - owrr) / 0.5
   *   - OWRR 0.5 (50) → strength 0.0
   *   - OWRR 0.25 (25) → strength 0.5
   *   - OWRR 0.0 (0) → strength 1.0
   */
  private getOWRRStrength(owrr: OWRRResult, side: TradeSide): number {
    const owrrNormalized = owrr.owrr; // 0-1 scale

    if (side === 'YES') {
      // Strength increases as OWRR increases above 0.5
      return Math.max(0, Math.min(1, (owrrNormalized - 0.5) / 0.5));
    } else {
      // Strength increases as OWRR decreases below 0.5
      return Math.max(0, Math.min(1, (0.5 - owrrNormalized) / 0.5));
    }
  }

  /**
   * Calculate overall confidence (0-1)
   */
  private calculateConfidence(owrr: OWRRResult): number {
    const confidenceMap: Record<string, number> = {
      high: 1.0,
      medium: 0.7,
      low: 0.4,
      insufficient_data: 0.0,
    };

    return confidenceMap[owrr.confidence] || 0;
  }
}
