/**
 * Smart Money Signals API v2
 *
 * Uses the validated signal engine based on backtesting 65,218 resolved markets.
 * Returns signals with expected ROI and win rates from historical data.
 *
 * Key signals:
 * - TECH_YES_AHEAD: 91% win rate, +47% ROI (892 trades)
 * - ECONOMY_YES_AHEAD: 100% win rate, +54% ROI (67 trades)
 * - FADE_OTHER_YES: 61% win rate, +36% ROI (4,186 trades)
 *
 * See: docs/smart-money-signals/SMART_MONEY_SIGNALS_RESEARCH.md
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@clickhouse/client";
import {
  detectSignal,
  detectSignalsBatch,
  calculateExpectedROI,
  getSignalDefinition,
  MarketSnapshot,
  DetectedSignal,
  MarketCategory,
} from "@/lib/smart-money";

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 30000,
});

// Map API category strings to our validated categories
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

interface SignalResponse {
  signal_type: string;
  market_id: string;
  question?: string;
  category: string;
  action: "BET_YES" | "BET_NO";
  entry_price: number;
  expected_roi: number;
  expected_win_rate: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  is_fade: boolean;
  divergence: number;
  smart_money_odds: number;
  crowd_price: number;
  wallet_count: number;
  total_usd: number;
  days_before: number;
  detected_at: string;
  backtest_stats: {
    trades: number;
    win_rate: number;
    roi: number;
  };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const marketId = searchParams.get("market_id");
    const category = searchParams.get("category");
    const minRoi = parseFloat(searchParams.get("min_roi") || "0");
    const minWinRate = parseFloat(searchParams.get("min_win_rate") || "0");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);

    // Build query to get market snapshots with category
    let query: string;
    const queryParams: Record<string, any> = { limit };

    if (marketId) {
      // Single market query
      query = `
        SELECT
          m.market_id,
          m.ts as timestamp,
          m.smart_money_odds,
          m.crowd_price,
          m.wallet_count,
          m.total_usd,
          meta.category,
          meta.question,
          meta.end_date,
          dateDiff('day', m.ts, meta.end_date) as days_before
        FROM wio_smart_money_metrics_v1 m
        JOIN pm_market_metadata meta ON m.market_id = meta.market_id
        WHERE m.market_id = {marketId:String}
          AND m.total_usd >= 5000
          AND meta.end_date > now()
        ORDER BY m.ts DESC
        LIMIT 1
      `;
      queryParams.marketId = marketId;
    } else {
      // Get latest snapshots for active markets
      query = `
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
            AND m.total_usd >= 5000
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
          ${category ? "AND lower(meta.category) = {category:String}" : ""}
        ORDER BY ls.total_usd DESC
        LIMIT {limit:UInt32}
      `;
      if (category) {
        queryParams.category = category.toLowerCase();
      }
    }

    const result = await clickhouse.query({
      query,
      query_params: queryParams,
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as any[];

    // Convert to MarketSnapshot format and detect signals
    const snapshots: (MarketSnapshot & { question?: string })[] = rows
      .map((row) => {
        const cat = normalizeCategory(row.category);
        if (!cat) return null;

        return {
          market_id: row.market_id,
          timestamp: new Date(row.timestamp),
          category: cat,
          smart_money_odds: row.smart_money_odds,
          crowd_price: row.crowd_price,
          wallet_count: row.wallet_count,
          total_usd: row.total_usd,
          days_before: Math.max(0, row.days_before || 0),
          question: row.question,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    // Detect signals for all snapshots
    const detectedSignals: SignalResponse[] = [];

    for (const snapshot of snapshots) {
      const signal = detectSignal(snapshot);
      if (!signal) continue;

      // Apply filters
      if (signal.expected_roi < minRoi) continue;
      if (signal.expected_win_rate < minWinRate) continue;

      const definition = getSignalDefinition(signal.signal_type);

      detectedSignals.push({
        signal_type: signal.signal_type,
        market_id: signal.market_id,
        question: snapshot.question,
        category: signal.category,
        action: signal.action,
        entry_price: signal.entry_price,
        expected_roi: signal.expected_roi,
        expected_win_rate: signal.expected_win_rate,
        confidence: signal.confidence,
        is_fade: signal.is_fade,
        divergence: signal.divergence,
        smart_money_odds: snapshot.smart_money_odds,
        crowd_price: snapshot.crowd_price,
        wallet_count: snapshot.wallet_count,
        total_usd: snapshot.total_usd,
        days_before: snapshot.days_before,
        detected_at: signal.detected_at.toISOString(),
        backtest_stats: definition
          ? {
              trades: definition.backtest.trades,
              win_rate: definition.backtest.win_rate,
              roi: definition.backtest.roi,
            }
          : { trades: 0, win_rate: 0, roi: 0 },
      });
    }

    // Sort by expected ROI descending
    detectedSignals.sort((a, b) => b.expected_roi - a.expected_roi);

    // Summary stats
    const summary = {
      total_signals: detectedSignals.length,
      markets_scanned: snapshots.length,
      by_category: {} as Record<string, number>,
      by_confidence: {
        HIGH: detectedSignals.filter((s) => s.confidence === "HIGH").length,
        MEDIUM: detectedSignals.filter((s) => s.confidence === "MEDIUM").length,
        LOW: detectedSignals.filter((s) => s.confidence === "LOW").length,
      },
      avg_expected_roi:
        detectedSignals.length > 0
          ? detectedSignals.reduce((sum, s) => sum + s.expected_roi, 0) /
            detectedSignals.length
          : 0,
      follow_signals: detectedSignals.filter((s) => !s.is_fade).length,
      fade_signals: detectedSignals.filter((s) => s.is_fade).length,
    };

    // Count by category
    for (const signal of detectedSignals) {
      summary.by_category[signal.category] =
        (summary.by_category[signal.category] || 0) + 1;
    }

    return NextResponse.json({
      signals: detectedSignals,
      summary,
      filters: {
        market_id: marketId,
        category,
        min_roi: minRoi,
        min_win_rate: minWinRate,
        limit,
      },
    });
  } catch (error) {
    console.error("Smart money signals v2 error:", error);
    return NextResponse.json(
      { error: "Failed to fetch smart money signals" },
      { status: 500 }
    );
  }
}
