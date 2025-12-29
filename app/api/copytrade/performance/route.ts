/**
 * Copy Trade Performance API
 *
 * GET /api/copytrade/performance - Fetch overall performance stats
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getPositionSummary,
  getPerformanceByWallet,
  getAllPositions,
} from "@/lib/copytrade/positionStore";

export async function GET(req: NextRequest) {
  try {
    const summary = getPositionSummary();
    const walletPerf = getPerformanceByWallet();
    const positions = getAllPositions();

    // Convert wallet performance map to sorted array
    const topWallets = Array.from(walletPerf.entries())
      .map(([wallet, perf]) => ({
        wallet,
        trades: perf.trades,
        pnl: perf.pnl,
        winRate: perf.winRate,
      }))
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, 10);

    // Calculate recent P&L by day (last 7 days)
    const now = new Date();
    const recentPnl: { date: string; pnl: number }[] = [];

    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];

      // Sum P&L for positions closed on this day
      let dayPnl = 0;
      for (const p of positions) {
        if (p.closedAt && p.closedAt.startsWith(dateStr) && p.realizedPnl) {
          dayPnl += p.realizedPnl;
        }
      }

      recentPnl.push({ date: dateStr, pnl: dayPnl });
    }

    // Market breakdown
    const marketBreakdown = new Map<string, { positions: number; pnl: number }>();
    for (const p of positions) {
      const existing = marketBreakdown.get(p.marketId) || { positions: 0, pnl: 0 };
      existing.positions++;
      existing.pnl += p.realizedPnl ?? p.unrealizedPnl ?? 0;
      marketBreakdown.set(p.marketId, existing);
    }

    const topMarkets = Array.from(marketBreakdown.entries())
      .map(([marketId, stats]) => ({
        marketId,
        positions: stats.positions,
        pnl: stats.pnl,
      }))
      .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
      .slice(0, 5);

    return NextResponse.json({
      success: true,
      data: {
        summary,
        topWallets,
        topMarkets,
        recentPnl,
      },
    });
  } catch (err) {
    console.error("[copytrade/performance] GET error", err);
    return NextResponse.json(
      { success: false, error: "Failed to fetch performance" },
      { status: 500 }
    );
  }
}
