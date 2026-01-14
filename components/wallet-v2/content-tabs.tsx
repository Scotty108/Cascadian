"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Position and trade components
import { PositionsTab } from "./positions-tab";
import { TradeHistory } from "./trade-history";
import { CategoryBreakdown } from "./category-breakdown";
import { FingerprintSection } from "./fingerprint-section";

// WIO components
import { WIOScoreCard } from "@/components/wallet-wio/wio-score-card";
import { CombinedMetricsSection } from "./combined-metrics-section";

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
  BubbleChartPosition,
} from "@/hooks/use-wallet-wio";
import type { FingerprintMetric } from "./types";

interface ContentTabsProps {
  // Positions data
  openPositions: OpenPosition[];
  closedPositions: ClosedPosition[];
  recentTrades: Trade[];
  categoryStats: CategoryStats[];
  bubbleChartData: BubbleChartPosition[];

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
  bubbleChartData,
  fingerprintMetrics,
  overallScore,
  score,
  metrics,
  allMetrics,
  selectedWindow,
  onWindowChange,
}: ContentTabsProps) {
  return (
    <Tabs defaultValue="overview" className="w-full">
      <TabsList className="w-full justify-start bg-transparent border-b border-border/50 rounded-none h-auto p-0 mb-4">
        <TabsTrigger
          value="overview"
          className="rounded-none border-b-2 border-transparent data-[state=active]:border-[#00E0AA] data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm font-medium"
        >
          Overview
        </TabsTrigger>
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
      </TabsList>

      {/* Overview Tab - Consolidated analytics view */}
      <TabsContent value="overview" className="mt-0 space-y-6">
        {/* WIO Intelligence Score */}
        {score && (
          <WIOScoreCard score={score} />
        )}

        {/* Wallet Fingerprint */}
        {fingerprintMetrics && fingerprintMetrics.length > 0 && (
          <FingerprintSection
            metrics={fingerprintMetrics}
            overallScore={overallScore ?? 0}
          />
        )}

        {/* Combined Performance & Core Metrics */}
        {metrics && (
          <CombinedMetricsSection
            metrics={metrics}
            allMetrics={allMetrics || []}
            fingerprintMetrics={fingerprintMetrics}
            selectedWindow={selectedWindow}
            onWindowChange={onWindowChange}
          />
        )}

        {/* Trading Activity Bubble Map */}
        {bubbleChartData && bubbleChartData.length > 0 && (
          <Card className="p-5 bg-card border-border/50">
            <TradingBubbleChart closedPositions={bubbleChartData as any} />
          </Card>
        )}

        {/* Performance by Category */}
        {categoryStats && categoryStats.length > 0 && (
          <CategoryBreakdown categories={categoryStats} />
        )}

        {/* Empty state */}
        {!score && !metrics && (!fingerprintMetrics || fingerprintMetrics.length === 0) && (
          <Card className="p-8 text-center text-muted-foreground">
            No overview data available
          </Card>
        )}
      </TabsContent>

      {/* Positions Tab */}
      <TabsContent value="positions" className="mt-0">
        <PositionsTab
          openPositions={openPositions}
          closedPositions={closedPositions}
        />
      </TabsContent>

      {/* Activity Tab */}
      <TabsContent value="activity" className="mt-0 space-y-6">
        {/* Trade History */}
        {recentTrades && recentTrades.length > 0 ? (
          <TradeHistory trades={recentTrades} />
        ) : (
          <Card className="p-8 text-center text-muted-foreground">
            No recent trades
          </Card>
        )}

        {/* Trading Calendar Heatmap */}
        {(closedPositions?.length > 0 || recentTrades?.length > 0) && (
          <Card className="p-5 bg-card border-border/50">
            <TradingCalendarHeatmap
              closedPositions={closedPositions as any}
              trades={recentTrades as any}
            />
          </Card>
        )}
      </TabsContent>
    </Tabs>
  );
}
