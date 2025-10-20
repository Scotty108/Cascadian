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

  // Filtering
  const filteredMarkets = useMemo(() => {
    return markets.filter((market) => {
      return categoryFilter === "all" || market.category === categoryFilter;
    });
  }, [markets, categoryFilter]);

  // Get color based on SII
  const getSIIColor = (sii: number) => {
    if (sii > 70) return "#16a34a";      // Dark Green
    if (sii > 40) return "#4ade80";      // Light Green
    if (sii > -40) return "#9ca3af";     // Gray
    if (sii > -70) return "#f87171";     // Light Red
    return "#dc2626";                     // Dark Red
  };

  const option = {
    tooltip: {
      formatter: (info: any) => {
        if (!info || !info.data || !info.data.marketTitle) {
          return "";
        }
        const { data } = info;
        return `
          <div style="padding: 8px;">
            <strong style="font-size: 14px;">${data.marketTitle}</strong><br/>
            <div style="margin-top: 4px;">
              SII: <span style="color: ${getSIIColor(data.sii)}; font-weight: bold;">${data.sii}</span><br/>
              24h Volume: <strong>$${data.value.toLocaleString()}</strong><br/>
              Price: <strong>${(data.currentPrice * 100).toFixed(1)}¢</strong>
            </div>
          </div>
        `;
      },
    },
    series: [
      {
        type: "treemap",
        data: filteredMarkets.map((m) => ({
          name: m.marketId,
          value: m.volume24h,
          marketTitle: m.title,
          sii: m.sii,
          currentPrice: m.currentPrice,
          itemStyle: {
            color: getSIIColor(m.sii),
            borderColor: "#fff",
            borderWidth: 3,
            gapWidth: 3,
          },
        })),
        label: {
          show: true,
          formatter: (params: any) => {
            // Show title + price
            if (!params || !params.data || !params.data.marketTitle) {
              return "";
            }
            const titleMaxLength = 40;
            const title =
              params.data.marketTitle.length > titleMaxLength
                ? params.data.marketTitle.substring(0, titleMaxLength) + "..."
                : params.data.marketTitle;
            return `${title}\n${(params.data.currentPrice * 100).toFixed(1)}¢`;
          },
          fontSize: 14,
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
      const marketId = params.data.name;
      router.push(`/analysis/market/${marketId}`);
    },
  };

  return (
    <div className="flex flex-col h-full space-y-4 p-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Market Map</h1>
          <p className="text-muted-foreground">
            Visual treemap showing all markets sized by volume, colored by SII
          </p>
        </div>
        <div className="flex gap-4 items-center">
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
      <div className="flex gap-6 text-sm">
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

      {/* Treemap */}
      <div className="flex-1 border rounded-lg overflow-hidden">
        <ReactECharts
          option={option}
          onEvents={onEvents}
          style={{ height: "100%", width: "100%" }}
          opts={{ renderer: "canvas" }}
        />
      </div>

      {/* Info */}
      <div className="text-sm text-muted-foreground">
        Showing {filteredMarkets.length} markets • Click any tile to view details
      </div>
    </div>
  );
}
