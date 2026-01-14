"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Position and trade components
import { PositionsTab } from "./positions-tab";
import { TradeHistory } from "./trade-history";
import { FingerprintSection } from "./fingerprint-section";
import { FingerprintSectionHorizontal } from "./fingerprint-section-horizontal";

// WIO components
import { WIOScoreCard } from "@/components/wallet-wio/wio-score-card";
import { WIOScoreCardHorizontal } from "@/components/wallet-wio/wio-score-card-horizontal";
import { CombinedMetricsSection } from "./combined-metrics-section";

// Trading activity visualizations
import { TradingBubbleChart } from "@/components/wallet-detail-interface/components/trading-bubble-chart";
import { TradingCalendarHeatmap } from "@/components/wallet-detail-interface/components/trading-calendar-heatmap";
import { EntryExitScatter } from "@/components/wallet-detail-interface/components/entry-exit-scatter";

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
  openPositionsCount?: number;
  closedPositionsCount?: number;
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

  // Loading state for progressive rendering
  isLoading?: boolean;
}

export function ContentTabs({
  openPositions,
  closedPositions,
  openPositionsCount,
  closedPositionsCount,
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
  isLoading,
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
        {/* Horizontal Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Credibility Score - Horizontal */}
          {(score || isLoading) && (
            <WIOScoreCardHorizontal score={score ?? null} isLoading={isLoading} />
          )}

          {/* Trader Profile - Horizontal */}
          {((fingerprintMetrics && fingerprintMetrics.length > 0) || isLoading) && (
            <FingerprintSectionHorizontal
              metrics={fingerprintMetrics ?? []}
              overallScore={overallScore ?? 0}
              isLoading={isLoading}
            />
          )}
        </div>

        {/* Performance Metrics - hidden, data now shown in stats row */}
        {/* {metrics && (
          <CombinedMetricsSection
            metrics={metrics}
            allMetrics={allMetrics || []}
            fingerprintMetrics={fingerprintMetrics}
            selectedWindow={selectedWindow}
            onWindowChange={onWindowChange}
          />
        )} */}

        {/* Trading Activity Section with integrated Category Breakdown */}
        {bubbleChartData && bubbleChartData.length > 0 && (
          <Card className="p-5 bg-card border-border/50">
            <TradingBubbleChart
              closedPositions={bubbleChartData as any}
              categoryStats={categoryStats}
            />
          </Card>
        )}

        {/* Entry vs Exit Price Analysis */}
        {closedPositions && closedPositions.length > 0 && (
          <Card className="p-5 bg-card border-border/50">
            <EntryExitScatter closedPositions={closedPositions as any} />
          </Card>
        )}

        {/* Empty state */}
        {!score && !metrics && (!fingerprintMetrics || fingerprintMetrics.length === 0) && (
          <Card className="p-8 text-center text-muted-foreground">
            No overview data available
          </Card>
        )}

        {/* Vertical Layout (Original) - commented out, keeping horizontal only
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
          {score && (
            <WIOScoreCard score={score} />
          )}
          {fingerprintMetrics && fingerprintMetrics.length > 0 && (
            <FingerprintSection
              metrics={fingerprintMetrics}
              overallScore={overallScore ?? 0}
            />
          )}
        </div>
        */}
      </TabsContent>

      {/* Positions Tab */}
      <TabsContent value="positions" className="mt-0">
        <PositionsTab
          openPositions={openPositions}
          closedPositions={closedPositions}
          openPositionsCount={openPositionsCount}
          closedPositionsCount={closedPositionsCount}
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
