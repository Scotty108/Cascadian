/**
 * Smart Money Opportunities API
 *
 * Returns top trading opportunities based on smart money signals.
 * Ranked by confidence score (derived from position size, divergence, timing).
 *
 * Filters:
 * - min_confidence: Minimum confidence score (0-100, default 50)
 * - strength: Filter by signal strength (WHALE, STRONG, MODERATE)
 * - direction: Filter by signal direction (YES, NO)
 * - limit: Max results (default 20)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@clickhouse/client";

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 30000,
});

interface Opportunity {
  rank: number;
  market_id: string;
  condition_id: string;
  // Signal data
  signal_direction: "YES" | "NO" | "NEUTRAL";
  signal_strength: "WHALE" | "STRONG" | "MODERATE" | "WEAK";
  confidence_score: number;
  // Metrics
  smart_money_odds: number;
  crowd_price: number;
  edge_pct: number;
  total_smart_money_usd: number;
  wallet_count: number;
  // Tier breakdown
  superforecaster_pct: number;
  smart_pct: number;
  profitable_pct: number;
  // Flow
  flow_24h: number;
  momentum: "BUYING" | "SELLING" | "NEUTRAL";
  // Timing
  hours_since_update: number;
  recommendation: string;
}

function calculateSignalStrength(totalUsd: number): Opportunity["signal_strength"] {
  if (totalUsd >= 500000) return "WHALE";
  if (totalUsd >= 100000) return "STRONG";
  if (totalUsd >= 20000) return "MODERATE";
  return "WEAK";
}

/**
 * VALIDATED CONFIDENCE SCORE based on backtesting 783 resolved markets:
 *
 * Best signals found:
 * - 500+ wallets + 10%+ divergence: 65% accuracy (20 markets)
 * - 200+ wallets + 10%+ divergence: 56.6% accuracy (83 markets)
 * - 100+ wallets + 20%+ divergence: 56.2% accuracy (112 markets)
 * - FADE small positions ($1K-20K): 53.9% accuracy (595 markets)
 *
 * Key insight: Wallet consensus + divergence from crowd matters more than position size
 */
function calculateConfidenceScore(
  totalUsd: number,
  divergence: number,
  smOdds: number,
  walletCount: number
): number {
  let score = 0;
  const absDivergence = Math.abs(divergence);

  // WALLET CONSENSUS is the strongest signal (0-40 points)
  // 500+ wallets = 65% accuracy, 200+ = 56.6%
  if (walletCount >= 500) score += 40;
  else if (walletCount >= 200) score += 30;
  else if (walletCount >= 100) score += 20;
  else if (walletCount >= 50) score += 10;

  // DIVERGENCE from crowd (0-35 points)
  // 10-30% divergence is optimal
  if (absDivergence >= 0.10 && absDivergence <= 0.30) score += 35;
  else if (absDivergence >= 0.05 && absDivergence <= 0.40) score += 20;
  else if (absDivergence > 0.40) score += 10; // Extreme divergence less reliable

  // Position size (0-15 points) - matters less than consensus
  if (totalUsd >= 100000) score += 15;
  else if (totalUsd >= 50000) score += 10;
  else if (totalUsd >= 20000) score += 5;
  // Small positions ($1K-20K) get NO bonus - consider fading

  // Moderate confidence penalty/bonus (0-10 points)
  // Extreme confidence (>80% or <20%) is less reliable
  if (smOdds >= 0.25 && smOdds <= 0.75) score += 10;
  else if (smOdds >= 0.20 && smOdds <= 0.80) score += 5;

  return Math.min(100, score);
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const minConfidence = parseInt(searchParams.get("min_confidence") || "50");
    const strengthFilter = searchParams.get("strength");
    const directionFilter = searchParams.get("direction");
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);

    // Get latest smart money metrics for active markets
    const query = `
      WITH latest_metrics AS (
        SELECT
          m.market_id,
          m.ts,
          m.smart_money_odds,
          m.crowd_price,
          m.total_usd,
          m.wallet_count,
          m.superforecaster_yes_usd + m.superforecaster_no_usd as superforecaster_usd,
          m.smart_yes_usd + m.smart_no_usd as smart_usd,
          m.profitable_yes_usd + m.profitable_no_usd as profitable_usd,
          m.flow_24h,
          ROW_NUMBER() OVER (PARTITION BY m.market_id ORDER BY m.ts DESC) as rn
        FROM wio_smart_money_metrics_v1 m
        WHERE m.total_usd >= 10000
          AND m.ts >= now() - INTERVAL 7 DAY
      )
      SELECT
        lm.market_id,
        lm.ts as timestamp,
        lm.smart_money_odds,
        lm.crowd_price,
        lm.total_usd,
        lm.wallet_count,
        lm.superforecaster_usd,
        lm.smart_usd,
        lm.profitable_usd,
        lm.flow_24h,
        dateDiff('hour', lm.ts, now()) as hours_since_update
      FROM latest_metrics lm
      WHERE lm.rn = 1
      ORDER BY lm.total_usd DESC
      LIMIT 200
    `;

    const result = await clickhouse.query({
      query,
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as any[];

    // Process and filter opportunities
    let opportunities: Opportunity[] = rows
      .map((row) => {
        const divergence = row.smart_money_odds - row.crowd_price;
        const direction: Opportunity["signal_direction"] =
          row.smart_money_odds > 0.55 ? "YES" : row.smart_money_odds < 0.45 ? "NO" : "NEUTRAL";
        const strength = calculateSignalStrength(row.total_usd);
        const confidenceScore = calculateConfidenceScore(
          row.total_usd,
          divergence,
          row.smart_money_odds,
          row.wallet_count
        );

        const totalTierUsd = row.superforecaster_usd + row.smart_usd + row.profitable_usd;
        const momentum: Opportunity["momentum"] =
          row.flow_24h > 5000 ? "BUYING" : row.flow_24h < -5000 ? "SELLING" : "NEUTRAL";

        let recommendation = "";
        if (strength === "WHALE") {
          recommendation = direction === "NEUTRAL"
            ? "WHALE ACTIVITY - Monitor closely"
            : `WHALE ${direction} - Highest conviction signal`;
        } else if (confidenceScore >= 70) {
          recommendation = direction === "NEUTRAL"
            ? "Strong activity, unclear direction"
            : `High confidence ${direction}`;
        } else if (confidenceScore >= 50) {
          recommendation = direction === "NEUTRAL"
            ? "Moderate activity"
            : `Lean ${direction}`;
        } else {
          recommendation = "Insufficient conviction";
        }

        return {
          rank: 0,
          market_id: row.market_id,
          condition_id: row.market_id,
          signal_direction: direction,
          signal_strength: strength,
          confidence_score: confidenceScore,
          smart_money_odds: row.smart_money_odds,
          crowd_price: row.crowd_price,
          edge_pct: divergence * 100,
          total_smart_money_usd: row.total_usd,
          wallet_count: row.wallet_count,
          superforecaster_pct: totalTierUsd > 0 ? (row.superforecaster_usd / totalTierUsd) * 100 : 0,
          smart_pct: totalTierUsd > 0 ? (row.smart_usd / totalTierUsd) * 100 : 0,
          profitable_pct: totalTierUsd > 0 ? (row.profitable_usd / totalTierUsd) * 100 : 0,
          flow_24h: row.flow_24h,
          momentum,
          hours_since_update: row.hours_since_update,
          recommendation,
        };
      })
      .filter((opp) => {
        // Apply filters
        if (opp.confidence_score < minConfidence) return false;
        if (strengthFilter && opp.signal_strength !== strengthFilter) return false;
        if (directionFilter && opp.signal_direction !== directionFilter) return false;
        return true;
      });

    // Sort by confidence score, then by total USD
    opportunities.sort((a, b) => {
      if (b.confidence_score !== a.confidence_score) {
        return b.confidence_score - a.confidence_score;
      }
      return b.total_smart_money_usd - a.total_smart_money_usd;
    });

    // Apply limit and add ranks
    opportunities = opportunities.slice(0, limit).map((opp, idx) => ({
      ...opp,
      rank: idx + 1,
    }));

    // Summary stats
    const summary = {
      total_opportunities: opportunities.length,
      whale_count: opportunities.filter((o) => o.signal_strength === "WHALE").length,
      strong_count: opportunities.filter((o) => o.signal_strength === "STRONG").length,
      yes_signals: opportunities.filter((o) => o.signal_direction === "YES").length,
      no_signals: opportunities.filter((o) => o.signal_direction === "NO").length,
      avg_confidence: opportunities.length > 0
        ? opportunities.reduce((sum, o) => sum + o.confidence_score, 0) / opportunities.length
        : 0,
      total_smart_money_tracked: opportunities.reduce((sum, o) => sum + o.total_smart_money_usd, 0),
    };

    return NextResponse.json({
      opportunities,
      summary,
      filters_applied: {
        min_confidence: minConfidence,
        strength: strengthFilter,
        direction: directionFilter,
        limit,
      },
    });
  } catch (error) {
    console.error("Smart money opportunities error:", error);
    return NextResponse.json(
      { error: "Failed to fetch opportunities" },
      { status: 500 }
    );
  }
}
