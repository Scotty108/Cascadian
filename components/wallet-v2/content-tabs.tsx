"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

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
import { EntryExitScatterV2 } from "@/components/wallet-detail-interface/components/entry-exit-scatter-v2";
import { HoldTimeRoiScatter } from "@/components/wallet-detail-interface/components/hold-time-roi-scatter";

// Lazy loading hooks
import { useWalletPositionsLazy } from "@/hooks/use-wallet-positions-lazy";
import { useWalletTradesLazy } from "@/hooks/use-wallet-trades-lazy";

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
  // Wallet address for lazy loading
  walletAddress: string;

  // Positions data (from main API - used for overview charts)
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
  walletAddress,
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
  const [activeTab, setActiveTab] = useState("overview");

  // Lazy load positions only when Positions tab is active
  const {
    openPositions: lazyOpenPositions,
    closedPositions: lazyClosedPositions,
    openCount: lazyOpenCount,
    closedCount: lazyClosedCount,
    pagination: positionsPagination,
    isLoading: positionsLoading,
  } = useWalletPositionsLazy({
    walletAddress,
    enabled: activeTab === "positions",
    pageSize: 100,
  });

  // Lazy load trades only when Activity tab is active
  const {
    trades: lazyTrades,
    pagination: tradesPagination,
    isLoading: tradesLoading,
  } = useWalletTradesLazy({
    walletAddress,
    enabled: activeTab === "activity",
    pageSize: 100,
  });

  // Use lazy-loaded data for Positions tab, fallback to props for overview charts
  const displayOpenPositions = activeTab === "positions" ? lazyOpenPositions : openPositions;
  const displayClosedPositions = activeTab === "positions" ? lazyClosedPositions : closedPositions;
  const displayTrades = activeTab === "activity" ? lazyTrades : recentTrades;

  return (
    <Tabs defaultValue="overview" className="w-full" onValueChange={setActiveTab}>
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

        {/* Trade Execution & Hold Time Analysis - Side by Side */}
        {closedPositions && closedPositions.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-5 bg-card border-border/50">
              <EntryExitScatterV2 closedPositions={closedPositions as any} />
            </Card>
            <Card className="p-5 bg-card border-border/50">
              <HoldTimeRoiScatter closedPositions={closedPositions as any} />
            </Card>
          </div>
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

      {/* Positions Tab - Lazy Loaded */}
      <TabsContent value="positions" className="mt-0">
        {positionsLoading ? (
          <Card className="p-8">
            <div className="flex items-center justify-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">Loading positions...</span>
            </div>
          </Card>
        ) : (
          <PositionsTab
            openPositions={displayOpenPositions}
            closedPositions={displayClosedPositions}
            openPositionsCount={activeTab === "positions" ? lazyOpenCount : openPositionsCount}
            closedPositionsCount={activeTab === "positions" ? positionsPagination.totalCount : closedPositionsCount}
          />
        )}
      </TabsContent>

      {/* Activity Tab - Lazy Loaded */}
      <TabsContent value="activity" className="mt-0 space-y-6">
        {tradesLoading ? (
          <Card className="p-8">
            <div className="flex items-center justify-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">Loading trades...</span>
            </div>
          </Card>
        ) : (
          <>
            {/* Trade History */}
            {displayTrades && displayTrades.length > 0 ? (
              <TradeHistory trades={displayTrades} />
            ) : (
              <Card className="p-8 text-center text-muted-foreground">
                No recent trades
              </Card>
            )}

            {/* Trading Calendar Heatmap */}
            {(closedPositions?.length > 0 || displayTrades?.length > 0) && (
              <Card className="p-5 bg-card border-border/50">
                <TradingCalendarHeatmap
                  closedPositions={closedPositions as any}
                  trades={displayTrades as any}
                />
              </Card>
            )}
          </>
        )}
      </TabsContent>
    </Tabs>
  );
}
