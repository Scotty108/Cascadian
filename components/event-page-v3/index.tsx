"use client";

import { useState, useCallback } from "react";
import { EventHeader } from "./event-header";
import { SmartPredictionCard } from "./smart-prediction-card";
import { MarketComparisonChart } from "./market-comparison-chart";
import { MarketCardsGrid } from "./market-cards-grid";
import { MarketDetailPanel } from "./market-detail-panel";
import { useEventSmartSummary, type SmartMarketData } from "./hooks/use-event-smart-summary";
import { Loader2, AlertCircle } from "lucide-react";

interface EventPageV3Props {
  eventSlug: string;
}

export function EventPageV3({ eventSlug }: EventPageV3Props) {
  const { event, smartPrediction, markets, isLoading, error } = useEventSmartSummary(eventSlug);
  const [selectedMarket, setSelectedMarket] = useState<SmartMarketData | null>(null);
  const [chartView, setChartView] = useState<"both" | "smart" | "crowd">("both");
  const [timeRange, setTimeRange] = useState<"1W" | "1M" | "3M" | "ALL">("1M");

  const handleMarketSelect = useCallback((market: SmartMarketData) => {
    setSelectedMarket(market);
  }, []);

  const handleClosePanel = useCallback(() => {
    setSelectedMarket(null);
  }, []);

  // Loading state
  if (isLoading && !event.title) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-[#00E0AA]" />
          <p className="text-sm text-muted-foreground">Loading event intelligence...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4 text-center">
          <AlertCircle className="h-8 w-8 text-rose-500" />
          <div>
            <h3 className="font-semibold">Failed to load event</h3>
            <p className="text-sm text-muted-foreground mt-1">{error.message}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      {/* Fixed Header */}
      <EventHeader event={event} />

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Hero: Smart Prediction Card */}
        <SmartPredictionCard
          smartPrediction={smartPrediction}
          eventTitle={event.title}
          onViewAllMarkets={() => {
            const grid = document.getElementById("markets-grid");
            grid?.scrollIntoView({ behavior: "smooth" });
          }}
        />

        {/* Historical Odds Chart */}
        <MarketComparisonChart
          markets={markets}
          chartView={chartView}
          onChartViewChange={setChartView}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          onMarketClick={handleMarketSelect}
        />

        {/* Markets Grid */}
        <div id="markets-grid">
          <MarketCardsGrid
            markets={markets}
            onMarketSelect={handleMarketSelect}
          />
        </div>
      </div>

      {/* Slide-over Panel for Market Detail */}
      {selectedMarket && (
        <MarketDetailPanel
          market={selectedMarket}
          onClose={handleClosePanel}
        />
      )}
    </div>
  );
}

export default EventPageV3;
