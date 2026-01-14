/**
 * Smart Money Opportunities API v2
 *
 * Returns ranked trading opportunities based on the validated signal engine.
 * Includes position sizing recommendations using Kelly Criterion.
 *
 * Based on backtesting 65,218 resolved markets with 1.6M snapshots.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@clickhouse/client";
import {
  detectSignal,
  getSignalDefinition,
  calculateKellyFraction,
  calculateQuarterKelly,
  calculateExpectedValue,
  MarketSnapshot,
  MarketCategory,
} from "@/lib/smart-money";

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 30000,
});

const CATEGORY_MAP: Record<string, MarketCategory | null> = {
  tech: "Tech",
  technology: "Tech",
  crypto: "Crypto",
  cryptocurrency: "Crypto",
  politics: "Politics",
  political: "Politics",
  economy: "Economy",
  economic: "Economy",
  finance: "Finance",
  financial: "Finance",
  culture: "Culture",
  pop_culture: "Culture",
  world: "World",
  global: "World",
  other: "Other",
  sports: "Sports",
};

function normalizeCategory(category: string): MarketCategory | null {
  const normalized = category?.toLowerCase().trim();
  return CATEGORY_MAP[normalized] || null;
}

interface Opportunity {
  rank: number;
  market_id: string;
  question: string;
  signal_type: string;
  signal_name: string;
  category: string;
  action: "BET_YES" | "BET_NO";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  // Expected returns
  expected_roi: number;
  expected_win_rate: number;
  expected_value: number;
  // Position sizing
  kelly_fraction: number;
  quarter_kelly: number;
  recommended_position_pct: number;
  // Market data
  entry_price: number;
  crowd_price: number;
  smart_money_odds: number;
  divergence: number;
  // Timing
  days_before: number;
  // Backtest stats
  backtest: {
    trades: number;
    win_rate: number;
    roi: number;
  };
  // Explanation
  reasoning: string[];
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const minConfidence = searchParams.get("min_confidence") || "MEDIUM";
    const category = searchParams.get("category");
    const followOnly = searchParams.get("follow_only") === "true";
    const fadeOnly = searchParams.get("fade_only") === "true";
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);

    // Confidence level mapping
    const confidenceLevels: Record<string, number> = {
      LOW: 1,
      MEDIUM: 2,
      HIGH: 3,
    };
    const minConfidenceLevel = confidenceLevels[minConfidence] || 2;

    // Get latest snapshots for active markets with signal potential
    const query = `
      WITH latest_snapshots AS (
        SELECT
          m.market_id,
          m.ts as timestamp,
          m.smart_money_odds,
          m.crowd_price,
          m.wallet_count,
          m.total_usd,
          ROW_NUMBER() OVER (PARTITION BY m.market_id ORDER BY m.ts DESC) as rn
        FROM wio_smart_money_metrics_v1 m
        WHERE m.ts >= now() - INTERVAL 7 DAY
          AND m.total_usd >= 10000
      )
      SELECT
        ls.market_id,
        ls.timestamp,
        ls.smart_money_odds,
        ls.crowd_price,
        ls.wallet_count,
        ls.total_usd,
        meta.category,
        meta.question,
        meta.end_date,
        dateDiff('day', ls.timestamp, meta.end_date) as days_before
      FROM latest_snapshots ls
      JOIN pm_market_metadata meta ON ls.market_id = meta.market_id
      WHERE ls.rn = 1
        AND meta.end_date > now()
        AND dateDiff('day', ls.timestamp, meta.end_date) >= 3
        ${category ? "AND lower(meta.category) = {category:String}" : ""}
      ORDER BY ls.total_usd DESC
      LIMIT 500
    `;

    const result = await clickhouse.query({
      query,
      query_params: category ? { category: category.toLowerCase() } : {},
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as any[];

    // Process snapshots and detect signals
    const opportunities: Opportunity[] = [];

    for (const row of rows) {
      const cat = normalizeCategory(row.category);
      if (!cat) continue;

      const snapshot: MarketSnapshot = {
        market_id: row.market_id,
        timestamp: new Date(row.timestamp),
        category: cat,
        smart_money_odds: row.smart_money_odds,
        crowd_price: row.crowd_price,
        wallet_count: row.wallet_count,
        total_usd: row.total_usd,
        days_before: Math.max(0, row.days_before || 0),
      };

      const signal = detectSignal(snapshot);
      if (!signal) continue;

      // Apply filters
      const signalConfidenceLevel = confidenceLevels[signal.confidence] || 1;
      if (signalConfidenceLevel < minConfidenceLevel) continue;
      if (followOnly && signal.is_fade) continue;
      if (fadeOnly && !signal.is_fade) continue;

      const definition = getSignalDefinition(signal.signal_type);
      if (!definition) continue;

      // Calculate position sizing
      const kelly = calculateKellyFraction(
        definition.backtest.win_rate,
        signal.entry_price
      );
      const quarterKelly = calculateQuarterKelly(
        definition.backtest.win_rate,
        signal.entry_price
      );
      const ev = calculateExpectedValue(
        definition.backtest.win_rate,
        signal.entry_price
      );

      // Generate reasoning
      const reasoning: string[] = [];

      if (signal.is_fade) {
        reasoning.push(
          `FADE signal: Historically profitable to bet AGAINST smart money in ${cat}`
        );
      } else {
        reasoning.push(
          `FOLLOW signal: Smart money has ${(definition.backtest.win_rate * 100).toFixed(0)}% historical accuracy in ${cat}`
        );
      }

      if (signal.divergence > 0.1) {
        reasoning.push(
          `Strong divergence: SM ${(signal.divergence * 100).toFixed(0)}% ahead of crowd`
        );
      }

      if (snapshot.days_before >= 7) {
        reasoning.push(`Early timing: ${snapshot.days_before} days before resolution`);
      }

      if (definition.backtest.trades >= 500) {
        reasoning.push(
          `High confidence: Based on ${definition.backtest.trades} historical trades`
        );
      }

      opportunities.push({
        rank: 0, // Will be set after sorting
        market_id: row.market_id,
        question: row.question,
        signal_type: signal.signal_type,
        signal_name: definition.name,
        category: signal.category,
        action: signal.action,
        confidence: signal.confidence,
        expected_roi: signal.expected_roi,
        expected_win_rate: signal.expected_win_rate,
        expected_value: ev,
        kelly_fraction: kelly,
        quarter_kelly: quarterKelly,
        recommended_position_pct: quarterKelly * 100,
        entry_price: signal.entry_price,
        crowd_price: snapshot.crowd_price,
        smart_money_odds: snapshot.smart_money_odds,
        divergence: signal.divergence,
        days_before: snapshot.days_before,
        backtest: {
          trades: definition.backtest.trades,
          win_rate: definition.backtest.win_rate,
          roi: definition.backtest.roi,
        },
        reasoning,
      });
    }

    // Sort by expected ROI * confidence weight
    opportunities.sort((a, b) => {
      const aWeight =
        a.confidence === "HIGH" ? 1.5 : a.confidence === "MEDIUM" ? 1.0 : 0.5;
      const bWeight =
        b.confidence === "HIGH" ? 1.5 : b.confidence === "MEDIUM" ? 1.0 : 0.5;
      return b.expected_roi * bWeight - a.expected_roi * aWeight;
    });

    // Apply limit and set ranks
    const rankedOpportunities = opportunities.slice(0, limit).map((opp, i) => ({
      ...opp,
      rank: i + 1,
    }));

    // Summary stats
    const summary = {
      total_opportunities: rankedOpportunities.length,
      markets_scanned: rows.length,
      avg_expected_roi:
        rankedOpportunities.length > 0
          ? rankedOpportunities.reduce((sum, o) => sum + o.expected_roi, 0) /
            rankedOpportunities.length
          : 0,
      avg_expected_win_rate:
        rankedOpportunities.length > 0
          ? rankedOpportunities.reduce((sum, o) => sum + o.expected_win_rate, 0) /
            rankedOpportunities.length
          : 0,
      by_confidence: {
        HIGH: rankedOpportunities.filter((o) => o.confidence === "HIGH").length,
        MEDIUM: rankedOpportunities.filter((o) => o.confidence === "MEDIUM").length,
        LOW: rankedOpportunities.filter((o) => o.confidence === "LOW").length,
      },
      follow_count: rankedOpportunities.filter(
        (o) => !o.signal_type.startsWith("FADE")
      ).length,
      fade_count: rankedOpportunities.filter((o) =>
        o.signal_type.startsWith("FADE")
      ).length,
      top_signal_types: Object.entries(
        rankedOpportunities.reduce(
          (acc, o) => {
            acc[o.signal_type] = (acc[o.signal_type] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        )
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([type, count]) => ({ type, count })),
    };

    return NextResponse.json({
      opportunities: rankedOpportunities,
      summary,
      filters: {
        min_confidence: minConfidence,
        category,
        follow_only: followOnly,
        fade_only: fadeOnly,
        limit,
      },
    });
  } catch (error) {
    console.error("Smart money opportunities v2 error:", error);
    return NextResponse.json(
      { error: "Failed to fetch opportunities" },
      { status: 500 }
    );
  }
}
