"use client";

import { useEffect, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { X, ExternalLink, TrendingUp, TrendingDown, Sparkles, Users, DollarSign, Clock, BarChart3, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSmartMoneySignals } from "@/hooks/use-smart-money-signals";
import { SmartMoneyBreakdownComponent } from "@/components/smart-money-breakdown";
import { MarketSmartMoneyWidget } from "@/components/market-smart-money-widget";
import type { SmartMarketData } from "../event-page-v3/hooks/use-event-smart-summary";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

interface MarketDetailV5Props {
  market: SmartMarketData;
  onClose: () => void;
}

// Fetch OHLC data
async function fetchMarketOHLC(clobTokenIds: string | undefined) {
  if (!clobTokenIds) return [];
  try {
    const tokens = JSON.parse(clobTokenIds);
    const tokenId = Array.isArray(tokens) && tokens[0] ? tokens[0] : null;
    if (!tokenId) return [];
    const response = await fetch(`/api/polymarket/ohlc/${tokenId}?interval=max`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.data || data.history || [];
  } catch {
    return [];
  }
}

export function MarketDetailV5({ market, onClose }: MarketDetailV5Props) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [isVisible, setIsVisible] = useState(false);
  const [ohlcData, setOhlcData] = useState<Array<{ t: number; c: number }>>([]);
  const [isLoadingOHLC, setIsLoadingOHLC] = useState(true);
  const [activeTab, setActiveTab] = useState<"chart" | "smart-money">("chart");

  // Fetch smart money signals
  const { data: smartMoneyData } = useSmartMoneySignals(market.conditionId || "", 90);

  // Fetch OHLC on mount
  useEffect(() => {
    setIsLoadingOHLC(true);
    fetchMarketOHLC(market.clobTokenIds).then((data) => {
      setOhlcData(data);
      setIsLoadingOHLC(false);
    });
  }, [market.clobTokenIds]);

  // Animate in
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);

  // Close with animation
  const handleClose = () => {
    setIsVisible(false);
    setTimeout(onClose, 200);
  };

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const crowdOdds = market.crowdOdds * 100;
  const smartOdds = market.smartOdds !== null ? market.smartOdds * 100 : null;
  const divergence = market.delta ? market.delta * 100 : null;

  const formatVolume = (vol: number) => {
    if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
    if (vol >= 1_000) return `$${(vol / 1_000).toFixed(0)}K`;
    return `$${vol.toFixed(0)}`;
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 bg-black/60 backdrop-blur-sm z-50 transition-opacity duration-200",
          isVisible ? "opacity-100" : "opacity-0"
        )}
        onClick={handleClose}
      />

      {/* Panel */}
      <div
        className={cn(
          "fixed inset-y-0 right-0 w-full max-w-2xl bg-background border-l border-border z-50",
          "flex flex-col transition-transform duration-200 ease-out",
          isVisible ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                {market.signal && market.signal !== "NEUTRAL" && (
                  <span
                    className={cn(
                      "px-2 py-0.5 text-xs font-semibold uppercase tracking-wider rounded-md",
                      market.signal === "BULLISH"
                        ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                        : "bg-rose-500/10 text-rose-500 border border-rose-500/20"
                    )}
                  >
                    {market.signal}
                  </span>
                )}
              </div>
              <h2 className="text-xl font-bold leading-tight line-clamp-2">
                {market.question}
              </h2>
            </div>
            <button
              onClick={handleClose}
              className="flex-shrink-0 p-2 rounded-lg hover:bg-muted transition-colors"
            >
              <X className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>

          {/* Odds Display */}
          <div className="flex items-center gap-6 mt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                <BarChart3 className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Crowd Odds</p>
                <p className="text-2xl font-mono font-bold">{crowdOdds.toFixed(0)}%</p>
              </div>
            </div>

            {smartOdds !== null && (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#00E0AA]/10 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-[#00E0AA]" />
                </div>
                <div>
                  <p className="text-xs text-[#00E0AA]">Smart Money</p>
                  <p className="text-2xl font-mono font-bold text-[#00E0AA]">{smartOdds.toFixed(0)}%</p>
                </div>
              </div>
            )}

            {divergence !== null && Math.abs(divergence) > 2 && (
              <div
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-xl",
                  divergence > 0
                    ? "bg-emerald-500/10 border border-emerald-500/20"
                    : "bg-rose-500/10 border border-rose-500/20"
                )}
              >
                {divergence > 0 ? (
                  <TrendingUp className="w-4 h-4 text-emerald-500" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-rose-500" />
                )}
                <span
                  className={cn(
                    "text-sm font-semibold",
                    divergence > 0 ? "text-emerald-500" : "text-rose-500"
                  )}
                >
                  {divergence > 0 ? "+" : ""}{divergence.toFixed(0)}pt
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex-shrink-0 flex border-b border-border">
          <button
            onClick={() => setActiveTab("chart")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors",
              activeTab === "chart"
                ? "text-[#00E0AA] border-b-2 border-[#00E0AA]"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Activity className="w-4 h-4" />
            Price History
          </button>
          <button
            onClick={() => setActiveTab("smart-money")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors",
              activeTab === "smart-money"
                ? "text-[#00E0AA] border-b-2 border-[#00E0AA]"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Sparkles className="w-4 h-4" />
            Smart Money
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "chart" && (
            <div className="p-6">
              {/* Price Chart */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-muted-foreground mb-4 uppercase tracking-wider">Price History</h3>
                <div className="rounded-xl border border-border bg-card/50 p-4">
                  <PriceChart
                    ohlcData={ohlcData}
                    smartMoneyData={smartMoneyData?.history || []}
                    isLoading={isLoadingOHLC}
                    isDark={isDark}
                  />
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="p-4 rounded-xl border border-border bg-card/50">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Smart $ Invested</span>
                  </div>
                  <p className="text-xl font-mono font-bold">
                    {formatVolume(market.totalInvested)}
                  </p>
                </div>
                <div className="p-4 rounded-xl border border-border bg-card/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-4 h-4 text-[#FBBF24]" />
                    <span className="text-xs text-muted-foreground">Superforecasters</span>
                  </div>
                  <p className="text-xl font-mono font-bold text-[#FBBF24]">
                    {market.superforecasterCount}
                  </p>
                </div>
              </div>

              {/* Market Info */}
              {market.image && (
                <div className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card/50">
                  <img
                    src={market.image}
                    alt=""
                    className="w-16 h-16 rounded-lg object-cover"
                  />
                  <div className="flex-1">
                    <p className="font-medium">{market.shortName}</p>
                    <p className="text-sm text-muted-foreground line-clamp-2">{market.question}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "smart-money" && (
            <div className="p-6 space-y-6">
              {market.conditionId ? (
                <>
                  <MarketSmartMoneyWidget marketId={market.id} />
                  <SmartMoneyBreakdownComponent conditionId={market.conditionId} />
                </>
              ) : (
                <div className="text-center py-12">
                  <Clock className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">Smart money data is being collected for this market</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 p-4 border-t border-border bg-muted/30">
          <a
            href={`https://polymarket.com/event/${market.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#00E0AA] text-black font-semibold hover:bg-[#00E0AA]/90 transition-colors"
          >
            Trade on Polymarket
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>
    </>
  );
}

// ============================================
// PRICE CHART
// ============================================

function PriceChart({
  ohlcData,
  smartMoneyData,
  isLoading,
  isDark,
}: {
  ohlcData: Array<{ t: number; c: number }>;
  smartMoneyData: Array<{ timestamp: number; smart_money_odds: number }>;
  isLoading: boolean;
  isDark: boolean;
}) {
  const chartData = useMemo(() => {
    if (ohlcData.length === 0) return { xAxis: [], crowdSeries: [], smartSeries: [] };

    // Last 90 days
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - 90 * 24 * 60 * 60;
    const filtered = ohlcData.filter((d) => d.t >= cutoff).sort((a, b) => a.t - b.t);

    const formatDate = (ts: number) => {
      const d = new Date(ts * 1000);
      return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]} ${d.getUTCDate()}`;
    };

    // Build smart money lookup
    const smartByDate = new Map<string, number>();
    smartMoneyData.forEach((p) => {
      const dateStr = formatDate(Math.floor(p.timestamp / 1000));
      smartByDate.set(dateStr, p.smart_money_odds);
    });

    const xAxis = filtered.map((d) => formatDate(d.t));
    const crowdSeries = filtered.map((d) => parseFloat((d.c * 100).toFixed(1)));
    const smartSeries = xAxis.map((date) => {
      const val = smartByDate.get(date);
      return val !== undefined ? Math.max(0, Math.min(100, val)) : null;
    });

    return { xAxis, crowdSeries, smartSeries };
  }, [ohlcData, smartMoneyData]);

  const hasSmartMoney = chartData.smartSeries.some((v) => v !== null);

  const textColor = isDark ? "#6b7280" : "#9ca3af";
  const gridColor = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
  const tooltipBg = isDark ? "#1f2937" : "#ffffff";
  const tooltipBorder = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
  const tooltipText = isDark ? "#fff" : "#1f2937";

  const chartOption = useMemo(() => ({
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      borderWidth: 1,
      textStyle: { color: tooltipText, fontSize: 12 },
    },
    legend: {
      data: ["Crowd Odds", ...(hasSmartMoney ? ["Smart Money"] : [])],
      top: 0,
      right: 0,
      textStyle: { color: textColor, fontSize: 11 },
      itemWidth: 16,
      itemHeight: 3,
    },
    grid: { left: 45, right: 15, bottom: 35, top: 35 },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: chartData.xAxis,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: textColor,
        fontSize: 10,
        interval: Math.max(0, Math.floor(chartData.xAxis.length / 5) - 1),
      },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: gridColor, type: "dashed" } },
      axisLabel: { color: textColor, fontSize: 10, formatter: "{value}%" },
    },
    series: [
      {
        name: "Crowd Odds",
        type: "line",
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2.5, color: "#00E0AA" },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(0, 224, 170, 0.2)" },
              { offset: 1, color: "rgba(0, 224, 170, 0)" },
            ],
          },
        },
        data: chartData.crowdSeries,
      },
      ...(hasSmartMoney ? [{
        name: "Smart Money",
        type: "line",
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2, color: "#22D3EE" },
        data: chartData.smartSeries,
        connectNulls: true,
      }] : []),
    ],
  }), [chartData, hasSmartMoney, textColor, gridColor, tooltipBg, tooltipBorder, tooltipText]);

  if (isLoading) {
    return (
      <div className="h-[280px] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#00E0AA]/20 border-t-[#00E0AA] rounded-full animate-spin" />
      </div>
    );
  }

  if (chartData.xAxis.length === 0) {
    return (
      <div className="h-[280px] flex items-center justify-center text-muted-foreground">
        No price data available
      </div>
    );
  }

  return (
    <div className="h-[280px]">
      <ReactECharts
        option={chartOption}
        style={{ height: "100%", width: "100%" }}
        opts={{ renderer: "svg" }}
      />
    </div>
  );
}
