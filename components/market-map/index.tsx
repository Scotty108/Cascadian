"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import ReactECharts from "echarts-for-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MarketMapTile } from "./types";

export function MarketMap() {
  const router = useRouter();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [timeWindow, setTimeWindow] = useState<string>("24h");

  // Mock data - will be replaced with API call
  const markets: MarketMapTile[] = [
    {
      marketId: "1",
      title: "Will Trump win the 2024 election?",
      category: "Politics",
      sii: 75,
      volume24h: 125000,
      currentPrice: 0.63,
    },
    {
      marketId: "2",
      title: "Will Bitcoin reach $100k by end of 2024?",
      category: "Crypto",
      sii: -45,
      volume24h: 89000,
      currentPrice: 0.28,
    },
    {
      marketId: "3",
      title: "Will Lakers win NBA Championship 2025?",
      category: "Sports",
      sii: 12,
      volume24h: 45000,
      currentPrice: 0.42,
    },
    {
      marketId: "4",
      title: "Will there be a recession in 2025?",
      category: "Politics",
      sii: -30,
      volume24h: 67000,
      currentPrice: 0.35,
    },
    {
      marketId: "5",
      title: "Will Ethereum reach $10k in 2025?",
      category: "Crypto",
      sii: 85,
      volume24h: 95000,
      currentPrice: 0.72,
    },
    {
      marketId: "6",
      title: "Will Taylor Swift win AOTY at Grammys?",
      category: "Entertainment",
      sii: 55,
      volume24h: 38000,
      currentPrice: 0.58,
    },
    {
      marketId: "7",
      title: "Will S&P 500 hit 6000 in 2025?",
      category: "Politics",
      sii: 40,
      volume24h: 72000,
      currentPrice: 0.51,
    },
    {
      marketId: "8",
      title: "Will Dodgers win World Series 2025?",
      category: "Sports",
      sii: -15,
      volume24h: 29000,
      currentPrice: 0.31,
    },
  ];

  // Get color based on SII
  const getSIIColor = (sii: number) => {
    if (sii > 70) return "#16a34a";      // Dark Green
    if (sii > 40) return "#4ade80";      // Light Green
    if (sii > -40) return "#9ca3af";     // Gray
    if (sii > -70) return "#f87171";     // Light Red
    return "#dc2626";                     // Dark Red
  };

  // Get category color
  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      Politics: "#3b82f6",      // Blue
      Sports: "#10b981",        // Green
      Crypto: "#f59e0b",        // Amber
      Entertainment: "#8b5cf6", // Purple
      Other: "#6b7280",         // Gray
    };
    return colors[category] || "#6b7280";
  };

  // Filtering
  const filteredMarkets = useMemo(() => {
    return markets.filter((market) => {
      return categoryFilter === "all" || market.category === categoryFilter;
    });
  }, [categoryFilter]);

  // Group markets by category for hierarchical treemap
  const groupedData = useMemo(() => {
    const categoryMap: Record<string, MarketMapTile[]> = {};

    filteredMarkets.forEach((market) => {
      if (!categoryMap[market.category]) {
        categoryMap[market.category] = [];
      }
      categoryMap[market.category].push(market);
    });

    // Convert to hierarchical structure
    return Object.entries(categoryMap).map(([category, categoryMarkets]) => ({
      name: category,
      // Parent value is sum of all children
      value: categoryMarkets.reduce((sum, m) => sum + m.volume24h, 0),
      itemStyle: {
        color: getCategoryColor(category),
      },
      children: categoryMarkets.map((m) => ({
        name: m.marketId,
        value: m.volume24h,
        marketTitle: m.title,
        sii: m.sii,
        currentPrice: m.currentPrice,
        category: m.category,
        itemStyle: {
          color: getSIIColor(m.sii),
        },
      })),
    }));
  }, [filteredMarkets]);

  const getTimeWindowLabel = () => {
    switch (timeWindow) {
      case "24h": return "24h";
      case "7d": return "7d";
      case "30d": return "30d";
      case "90d": return "90d";
      default: return "24h";
    }
  };

  const option = {
    tooltip: {
      formatter: (info: any) => {
        if (!info || !info.data) {
          return "";
        }
        const { data } = info;

        // If this is a category (parent node)
        if (data.children) {
          return `
            <div style="padding: 8px;">
              <strong style="font-size: 16px;">${data.name}</strong><br/>
              <div style="margin-top: 4px;">
                Markets: <strong>${data.children.length}</strong><br/>
                Total ${getTimeWindowLabel()} Volume: <strong>$${data.value.toLocaleString()}</strong>
              </div>
            </div>
          `;
        }

        // If this is a market (child node)
        if (data.marketTitle) {
          return `
            <div style="padding: 8px;">
              <strong style="font-size: 14px;">${data.marketTitle}</strong><br/>
              <div style="margin-top: 4px;">
                Category: <strong>${data.category}</strong><br/>
                SII: <span style="color: ${getSIIColor(data.sii)}; font-weight: bold;">${data.sii}</span><br/>
                ${getTimeWindowLabel()} Volume: <strong>$${data.value.toLocaleString()}</strong><br/>
                Price: <strong>${(data.currentPrice * 100).toFixed(1)}¢</strong>
              </div>
            </div>
          `;
        }

        return "";
      },
    },
    series: [
      {
        type: "treemap",
        data: groupedData,
        // Show parent labels
        upperLabel: {
          show: true,
          height: 30,
          fontSize: 16,
          fontWeight: "bold",
          color: "#fff",
        },
        // Configure levels
        levels: [
          {
            // Root level - not visible
            itemStyle: {
              borderWidth: 0,
              gapWidth: 5,
            },
          },
          {
            // Category level (parent)
            itemStyle: {
              borderWidth: 4,
              gapWidth: 4,
              borderColor: "#fff",
            },
            upperLabel: {
              show: true,
              height: 30,
              fontSize: 16,
              fontWeight: "bold",
              color: "#fff",
            },
          },
          {
            // Market level (children)
            itemStyle: {
              borderWidth: 2,
              gapWidth: 2,
              borderColor: "#fff",
            },
          },
        ],
        label: {
          show: true,
          formatter: (params: any) => {
            if (!params || !params.data) {
              return "";
            }

            // For market nodes (children)
            if (params.data.marketTitle) {
              const titleMaxLength = 40;
              const title =
                params.data.marketTitle.length > titleMaxLength
                  ? params.data.marketTitle.substring(0, titleMaxLength) + "..."
                  : params.data.marketTitle;
              return `${title}\n${(params.data.currentPrice * 100).toFixed(1)}¢`;
            }

            // For category nodes (parents) - label shown in upperLabel
            return "";
          },
          fontSize: 12,
          color: "#fff",
          fontWeight: "bold",
          overflow: "break",
        },
        breadcrumb: {
          show: false,
        },
        roam: false,
        nodeClick: "link",
      },
    ],
  };

  const onEvents = {
    click: (params: any) => {
      // Only navigate if clicking on a market (child node), not a category (parent node)
      if (params.data && params.data.marketTitle && !params.data.children) {
        const marketId = params.data.name;
        router.push(`/analysis/market/${marketId}`);
      }
    },
  };

  return (
    <div className="flex flex-col space-y-4">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Market Map</h1>
          <p className="text-muted-foreground">
            Hierarchical treemap grouped by category, markets sized by volume and colored by SII
          </p>
        </div>
        <div className="flex gap-4 items-center">
          <Select value={timeWindow} onValueChange={setTimeWindow}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Time Window" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">24 Hours</SelectItem>
              <SelectItem value="7d">7 Days</SelectItem>
              <SelectItem value="30d">30 Days</SelectItem>
              <SelectItem value="90d">90 Days</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="Politics">Politics</SelectItem>
              <SelectItem value="Sports">Sports</SelectItem>
              <SelectItem value="Crypto">Crypto</SelectItem>
              <SelectItem value="Entertainment">Entertainment</SelectItem>
              <SelectItem value="Other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Legend */}
      <div className="space-y-3">
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2">CATEGORIES</div>
          <div className="flex gap-4 text-sm flex-wrap">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#3b82f6" }} />
              <span>Politics</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#10b981" }} />
              <span>Sports</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#f59e0b" }} />
              <span>Crypto</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#8b5cf6" }} />
              <span>Entertainment</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#6b7280" }} />
              <span>Other</span>
            </div>
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2">MARKET SII SCORES</div>
          <div className="flex gap-4 text-sm flex-wrap">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#16a34a" }} />
              <span>SII &gt; 70 (Strong Buy)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#4ade80" }} />
              <span>SII 40-70 (Buy)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#9ca3af" }} />
              <span>SII -40 to 40 (Neutral)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#f87171" }} />
              <span>SII -70 to -40 (Sell)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: "#dc2626" }} />
              <span>SII &lt; -70 (Strong Sell)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Treemap */}
      <div className="border rounded-lg overflow-hidden" style={{ height: "calc(100vh - 450px)", minHeight: "500px" }}>
        <ReactECharts
          option={option}
          onEvents={onEvents}
          style={{ height: "100%", width: "100%" }}
          opts={{ renderer: "canvas" }}
        />
      </div>

      {/* Info */}
      <div className="text-sm text-muted-foreground">
        Showing {filteredMarkets.length} markets for {timeWindow === "24h" ? "24 hours" : timeWindow === "7d" ? "7 days" : timeWindow === "30d" ? "30 days" : "90 days"} • Click any tile to view details
      </div>
    </div>
  );
}
