"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Position and trade components
import { PositionsTab } from "./positions-tab";
import { TradeHistory } from "./trade-history";
import { CategoryBreakdown } from "./category-breakdown";
import { FingerprintSection } from "./fingerprint-section";
import { CoreMetricsGrid } from "./core-metrics-grid";

// WIO components
import { WIOScoreCard } from "@/components/wallet-wio/wio-score-card";
import { PerformanceMetrics } from "@/components/wallet-wio/performance-metrics";

// Trading activity visualizations
import { TradingBubbleChart } from "@/components/wallet-detail-interface/components/trading-bubble-chart";
import { TradingCalendarHeatmap } from "@/components/wallet-detail-interface/components/trading-calendar-heatmap";

// Types
import {
  OpenPosition,
  ClosedPosition,
  Trade,
  CategoryStats,
  WalletScore,
  WalletMetrics,
  TimeWindow,
} from "@/hooks/use-wallet-wio";
import type { FingerprintMetric } from "./types";

interface ContentTabsProps {
  // Positions data
  openPositions: OpenPosition[];
  closedPositions: ClosedPosition[];
  recentTrades: Trade[];
  categoryStats: CategoryStats[];

  // Fingerprint data
  fingerprintMetrics?: FingerprintMetric[] | null;
  overallScore?: number;

  // WIO Score & Metrics
  score?: WalletScore | null;
  metrics?: WalletMetrics | null;
  allMetrics?: WalletMetrics[];

  // Window selection
  selectedWindow: TimeWindow;
  onWindowChange: (window: TimeWindow) => void;
}

export function ContentTabs({
  openPositions,
  closedPositions,
  recentTrades,
  categoryStats,
  fingerprintMetrics,
  overallScore,
  score,
  metrics,
  allMetrics,
  selectedWindow,
  onWindowChange,
}: ContentTabsProps) {
  return (
    <Tabs defaultValue="positions" className="w-full">
      <TabsList className="w-full justify-start bg-transparent border-b border-border/50 rounded-none h-auto p-0 mb-4">
        <TabsTrigger
          value="positions"
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-[#00E0AA] data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm font-medium"
        >
          Positions
        </TabsTrigger>
        <TabsTrigger
          value="activity"
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-[#00E0AA] data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm font-medium"
        >
          Activity
        </TabsTrigger>
        <TabsTrigger
          value="performance"
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-[#00E0AA] data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm font-medium"
        >
          Performance
        </TabsTrigger>
        <TabsTrigger
          value="fingerprint"
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-[#00E0AA] data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm font-medium"
        >
          Fingerprint
        </TabsTrigger>
      </TabsList>

      {/* Positions Tab */}
      <TabsContent value="positions" className="mt-0">
        <PositionsTab
          openPositions={openPositions}
          closedPositions={closedPositions}
        />
      </TabsContent>

      {/* Activity Tab */}
      <TabsContent value="activity" className="mt-0">
        {recentTrades && recentTrades.length > 0 ? (
          <TradeHistory trades={recentTrades} />
        ) : (
          <Card className="p-8 text-center text-muted-foreground">
            No recent trades
          </Card>
        )}
      </TabsContent>

      {/* Performance Tab - Contains WIO Score, Metrics, and Category Breakdown */}
      <TabsContent value="performance" className="mt-0 space-y-6">
        {/* WIO Intelligence Score */}
        {score && (
          <WIOScoreCard score={score} />
        )}

        {/* Performance Metrics with Time Window Selector */}
        {metrics && (
          <PerformanceMetrics
            metrics={metrics}
            allMetrics={allMetrics || []}
            selectedWindow={selectedWindow}
            onWindowChange={onWindowChange}
          />
        )}

        {/* Core Metrics Grid (from fingerprint) */}
        {fingerprintMetrics && fingerprintMetrics.length > 0 && (
          <Card className="p-5 bg-card border-border/50">
            <h3 className="text-lg font-semibold mb-4">Core Metrics</h3>
            <CoreMetricsGrid metrics={fingerprintMetrics} />
          </Card>
        )}

        {/* Trading Activity Bubble Map */}
        {closedPositions && closedPositions.length > 0 && (
          <Card className="p-5 bg-card border-border/50">
            <TradingBubbleChart closedPositions={closedPositions as any} />
          </Card>
        )}

        {/* Trading Activity Calendar */}
        {(closedPositions?.length > 0 || recentTrades?.length > 0) && (
          <Card className="p-5 bg-card border-border/50">
            <TradingCalendarHeatmap
              closedPositions={closedPositions as any}
              trades={recentTrades as any}
            />
          </Card>
        )}

        {/* Category Breakdown */}
        {categoryStats && categoryStats.length > 0 && (
          <CategoryBreakdown categories={categoryStats} />
        )}

        {/* Empty state if nothing available */}
        {!score && !metrics && (!categoryStats || categoryStats.length === 0) && (
          <Card className="p-8 text-center text-muted-foreground">
            No performance data available
          </Card>
        )}
      </TabsContent>

      {/* Fingerprint Tab */}
      <TabsContent value="fingerprint" className="mt-0">
        {fingerprintMetrics && fingerprintMetrics.length > 0 ? (
          <FingerprintSection
            metrics={fingerprintMetrics}
            overallScore={overallScore ?? 0}
          />
        ) : (
          <Card className="p-8 text-center text-muted-foreground">
            No fingerprint data available
          </Card>
        )}
      </TabsContent>
    </Tabs>
  );
}
