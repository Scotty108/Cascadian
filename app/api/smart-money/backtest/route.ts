/**
 * Smart Money Backtest API
 *
 * Run backtests on historical data using the validated signal engine.
 * Returns performance metrics for specified signals or custom conditions.
 *
 * Based on 65,218 resolved markets with 1.6M snapshots.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@clickhouse/client";
import {
  detectSignal,
  calculateROI,
  calculateTradeStats,
  calculateMaxDrawdown,
  getSignalDefinition,
  SIGNAL_DEFINITIONS,
  MarketSnapshot,
  MarketCategory,
  SignalType,
  TradeResult,
} from "@/lib/smart-money";

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 120000, // 2 minutes for backtest queries
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

interface BacktestResult {
  signal_type: string;
  signal_name: string;
  category: string;
  action: string;
  // Performance metrics
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_roi: number;
  avg_roi: number;
  max_win: number;
  max_loss: number;
  max_drawdown: number;
  profit_factor: number;
  sharpe_ratio: number;
  // Expected value
  expected_value_per_trade: number;
  // Sample trades
  sample_trades?: Array<{
    market_id: string;
    entry_price: number;
    outcome: number;
    roi: number;
  }>;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const signalType = searchParams.get("signal_type") as SignalType | null;
    const category = searchParams.get("category");
    const minDaysBefore = parseInt(searchParams.get("min_days_before") || "0");
    const maxDaysBefore = parseInt(
      searchParams.get("max_days_before") || "365"
    );
    const includeSamples = searchParams.get("include_samples") === "true";
    const limit = Math.min(
      parseInt(searchParams.get("limit") || "50000"),
      100000
    );

    // If specific signal type requested, just return its definition stats
    if (signalType) {
      const definition = getSignalDefinition(signalType);
      if (!definition) {
        return NextResponse.json(
          { error: `Unknown signal type: ${signalType}` },
          { status: 400 }
        );
      }

      return NextResponse.json({
        backtest: {
          signal_type: definition.type,
          signal_name: definition.name,
          category: definition.conditions.category.join(", "),
          action: definition.action,
          trades: definition.backtest.trades,
          wins: Math.round(
            definition.backtest.trades * definition.backtest.win_rate
          ),
          losses: Math.round(
            definition.backtest.trades * (1 - definition.backtest.win_rate)
          ),
          win_rate: definition.backtest.win_rate,
          total_roi:
            definition.backtest.roi * definition.backtest.trades,
          avg_roi: definition.backtest.roi,
          max_win: null, // Would need to query for this
          max_loss: -1.0,
          max_drawdown: definition.backtest.max_drawdown || null,
          profit_factor: definition.backtest.profit_factor || null,
          sharpe_ratio: definition.backtest.sharpe_ratio || null,
          expected_value_per_trade: definition.backtest.roi,
        },
        definition,
        source: "signal_definition",
      });
    }

    // Run full backtest on historical data
    // Query resolved markets with their snapshots
    const query = `
      WITH resolved_markets AS (
        SELECT
          market_id,
          category,
          outcome_side as resolved_outcome
        FROM wio_market_snapshots_v1
        WHERE resolved_outcome IS NOT NULL
          ${category ? "AND lower(category) = {category:String}" : ""}
        GROUP BY market_id, category, resolved_outcome
      ),
      market_snapshots AS (
        SELECT
          s.market_id,
          s.ts as timestamp,
          s.sm_odds as smart_money_odds,
          s.crowd_price,
          s.wallet_count,
          s.total_usd,
          rm.category,
          rm.resolved_outcome,
          s.days_before
        FROM wio_market_snapshots_v1 s
        JOIN resolved_markets rm ON s.market_id = rm.market_id
        WHERE s.days_before >= {minDaysBefore:UInt32}
          AND s.days_before <= {maxDaysBefore:UInt32}
          AND s.total_usd >= 5000
      )
      SELECT
        market_id,
        timestamp,
        smart_money_odds,
        crowd_price,
        wallet_count,
        total_usd,
        category,
        resolved_outcome,
        days_before
      FROM market_snapshots
      ORDER BY timestamp
      LIMIT {limit:UInt32}
    `;

    const result = await clickhouse.query({
      query,
      query_params: {
        category: category?.toLowerCase() || "",
        minDaysBefore,
        maxDaysBefore,
        limit,
      },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as any[];

    if (rows.length === 0) {
      return NextResponse.json({
        backtest: null,
        message: "No matching snapshots found for backtest",
        filters: {
          category,
          min_days_before: minDaysBefore,
          max_days_before: maxDaysBefore,
          limit,
        },
      });
    }

    // Group by signal type
    const signalResults: Map<
      string,
      {
        definition: (typeof SIGNAL_DEFINITIONS)[0] | null;
        trades: TradeResult[];
        samples: Array<{
          market_id: string;
          entry_price: number;
          outcome: number;
          roi: number;
        }>;
      }
    > = new Map();

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
        days_before: row.days_before,
      };

      const signal = detectSignal(snapshot);
      if (!signal) continue;

      // Create trade result
      const trade: TradeResult = {
        action: signal.action,
        entry_price: signal.entry_price,
        outcome: row.resolved_outcome === "YES" ? 1 : 0,
      };

      // Add to signal results
      if (!signalResults.has(signal.signal_type)) {
        signalResults.set(signal.signal_type, {
          definition: getSignalDefinition(signal.signal_type) || null,
          trades: [],
          samples: [],
        });
      }

      const signalData = signalResults.get(signal.signal_type)!;
      signalData.trades.push(trade);

      // Add sample
      if (includeSamples && signalData.samples.length < 10) {
        const roi = calculateROI(trade);
        signalData.samples.push({
          market_id: row.market_id,
          entry_price: signal.entry_price,
          outcome: row.resolved_outcome === "YES" ? 1 : 0,
          roi,
        });
      }
    }

    // Calculate stats for each signal type
    const backtests: BacktestResult[] = [];

    for (const [signalType, data] of signalResults) {
      if (data.trades.length === 0) continue;

      const stats = calculateTradeStats(data.trades);
      const maxDrawdown = calculateMaxDrawdown(data.trades);

      const backtest: BacktestResult = {
        signal_type: signalType,
        signal_name: data.definition?.name || signalType,
        category: data.definition?.conditions.category.join(", ") || "",
        action: data.definition?.action || "",
        trades: stats.trades,
        wins: stats.wins,
        losses: stats.losses,
        win_rate: stats.win_rate,
        total_roi: stats.total_roi,
        avg_roi: stats.avg_roi,
        max_win: stats.max_win,
        max_loss: stats.max_loss,
        max_drawdown: maxDrawdown,
        profit_factor: stats.profit_factor,
        sharpe_ratio: stats.sharpe_ratio,
        expected_value_per_trade: stats.avg_roi,
      };

      if (includeSamples) {
        backtest.sample_trades = data.samples;
      }

      backtests.push(backtest);
    }

    // Sort by total ROI
    backtests.sort((a, b) => b.avg_roi - a.avg_roi);

    // Summary
    const totalTrades = backtests.reduce((sum, b) => sum + b.trades, 0);
    const totalWins = backtests.reduce((sum, b) => sum + b.wins, 0);

    const summary = {
      snapshots_analyzed: rows.length,
      signals_detected: totalTrades,
      overall_win_rate: totalTrades > 0 ? totalWins / totalTrades : 0,
      signal_types_found: backtests.length,
      best_signal:
        backtests.length > 0
          ? {
              type: backtests[0].signal_type,
              avg_roi: backtests[0].avg_roi,
              win_rate: backtests[0].win_rate,
              trades: backtests[0].trades,
            }
          : null,
    };

    return NextResponse.json({
      backtests,
      summary,
      filters: {
        signal_type: signalType,
        category,
        min_days_before: minDaysBefore,
        max_days_before: maxDaysBefore,
        limit,
      },
    });
  } catch (error) {
    console.error("Backtest error:", error);
    return NextResponse.json(
      { error: "Failed to run backtest" },
      { status: 500 }
    );
  }
}
