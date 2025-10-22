"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactECharts from "echarts-for-react";
import { TrendingUp, ArrowLeft, Calendar, ExternalLink, Users, Clock, DollarSign, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { TruncatedTable } from "@/components/ui/truncated-table";
import {
  generateMarketDetail,
  generatePriceHistory,
  generateHolders,
  generateWhaleTrades,
  generateSIIHistory,
  generateSignalBreakdown,
  generateRelatedMarkets,
} from "@/lib/generate-market-detail";
import type {
  MarketDetail as MarketDetailType,
  PriceHistoryPoint,
  SignalBreakdown,
  WhaleTradeForMarket,
  OrderBook,
  SIIHistoryPoint,
  RelatedMarket,
  HolderPosition,
  HoldersSummary,
  OHLCDataPoint,
} from "./types";

interface MarketDetailProps {
  marketId: string;
}

export function MarketDetail({ marketId }: MarketDetailProps) {
  const router = useRouter();
  const [priceTimeframe, setPriceTimeframe] = useState<"1h" | "24h" | "7d" | "30d">("7d");

  // Generate data using generators
  const market = generateMarketDetail('Politics');

  // Mock additional market data - in real implementation, this would come from API
  const marketData = {
    ...market,
    tradersCount: 12345,
    startDate: "2023-01-15T00:00:00Z",
    polymarketUrl: "https://polymarket.com/market/will-donald-trump-win-2024",
    rules: "This market resolves to YES if Donald Trump wins the 2024 United States Presidential Election, as determined by the official certification of electoral college votes. The market will resolve once the election results are certified by Congress in January 2025.",
  };

  // Mock event slug - in real implementation, this would come from the market data
  const eventSlug = "2024-presidential-election";
  const priceHistory = generatePriceHistory(market.current_price, 168);
  const yesHolders = generateHolders('YES', 156, market.current_price);
  const noHolders = generateHolders('NO', 98, market.current_price);
  const whaleTrades = generateWhaleTrades(20, market.current_price);
  const siiHistory = generateSIIHistory(market.sii, 48);
  const signalBreakdown = generateSignalBreakdown();
  const relatedMarkets = generateRelatedMarkets(market.category, 3);

  // Calculate holder summaries
  const yesSummary: HoldersSummary = {
    side: "YES",
    holders_count: 156,
    profit_usd: yesHolders.filter(h => h.pnl_total > 0).reduce((sum, h) => sum + h.pnl_total, 0),
    loss_usd: yesHolders.filter(h => h.pnl_total < 0).reduce((sum, h) => sum + h.pnl_total, 0),
    realized_price: yesHolders.reduce((sum, h) => sum + h.avg_entry, 0) / yesHolders.length,
  };

  const noSummary: HoldersSummary = {
    side: "NO",
    holders_count: 98,
    profit_usd: noHolders.filter(h => h.pnl_total > 0).reduce((sum, h) => sum + h.pnl_total, 0),
    loss_usd: noHolders.filter(h => h.pnl_total < 0).reduce((sum, h) => sum + h.pnl_total, 0),
    realized_price: noHolders.reduce((sum, h) => sum + h.avg_entry, 0) / noHolders.length,
  };

  // Order book
  const orderBook: OrderBook = {
    bids: [
      { price: 0.6295, size: 10000, total: 10000 },
      { price: 0.6290, size: 15000, total: 25000 },
      { price: 0.6285, size: 20000, total: 45000 },
      { price: 0.6280, size: 25000, total: 70000 },
      { price: 0.6275, size: 30000, total: 100000 },
    ],
    asks: [
      { price: 0.6305, size: 12000, total: 12000 },
      { price: 0.6310, size: 18000, total: 30000 },
      { price: 0.6315, size: 22000, total: 52000 },
      { price: 0.6320, size: 28000, total: 80000 },
      { price: 0.6325, size: 35000, total: 115000 },
    ],
    timestamp: new Date().toISOString(),
  };

  // OHLC data (7 days, 4h candles)
  const ohlcData: OHLCDataPoint[] = Array.from({ length: 42 }, (_, i) => {
    const basePrice = 0.55 + (i / 42) * 0.08;
    const volatility = 0.02;
    return {
      timestamp: new Date(Date.now() - (42 - i) * 4 * 3600000).toISOString(),
      open: basePrice + (Math.random() - 0.5) * volatility,
      high: basePrice + Math.random() * volatility,
      low: basePrice - Math.random() * volatility,
      close: basePrice + (Math.random() - 0.5) * volatility,
      volume: 15000 + Math.random() * 35000,
    };
  });

  // Price chart option with YES and NO lines
  const priceChartOption = {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      formatter: (params: any) => {
        const timestamp = params[0].name;
        const yesValue = params[0].value;
        const noValue = params[1].value;
        return `
          <div style="padding: 8px;">
            <div><strong>${new Date(timestamp).toLocaleString()}</strong></div>
            <div style="margin-top: 4px; color: #3b82f6;">
              YES: <strong>${(yesValue * 100).toFixed(1)}¢</strong>
            </div>
            <div style="color: #f59e0b;">
              NO: <strong>${(noValue * 100).toFixed(1)}¢</strong>
            </div>
          </div>
        `;
      },
    },
    legend: {
      data: ["YES Price", "NO Price"],
      top: 0,
    },
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      containLabel: true,
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: priceHistory.map((p) => p.timestamp),
      axisLabel: {
        formatter: (value: string) => {
          const date = new Date(value);
          if (priceTimeframe === "1h") {
            return `${date.getHours()}:${date.getMinutes().toString().padStart(2, "0")}`;
          } else if (priceTimeframe === "24h") {
            return `${date.getHours()}:00`;
          } else {
            return `${date.getMonth() + 1}/${date.getDate()}`;
          }
        },
      },
    },
    yAxis: {
      type: "value",
      name: "Price",
      axisLabel: {
        formatter: (value: number) => `${(value * 100).toFixed(0)}¢`,
      },
      min: 0,
      max: 1,
    },
    series: [
      {
        name: "YES Price",
        type: "line",
        smooth: true,
        data: priceHistory.map((p) => p.price),
        lineStyle: { width: 3, color: "#3b82f6" },
        itemStyle: { color: "#3b82f6" },
        areaStyle: { color: "rgba(59, 130, 246, 0.1)" },
      },
      {
        name: "NO Price",
        type: "line",
        smooth: true,
        data: priceHistory.map((p) => 1 - p.price),
        lineStyle: { width: 3, color: "#f59e0b" },
        itemStyle: { color: "#f59e0b" },
        areaStyle: { color: "rgba(245, 158, 11, 0.1)" },
      },
    ],
  };

  // SII chart option
  const siiChartOption = {
    tooltip: {
      trigger: "axis",
    },
    xAxis: {
      type: "category",
      data: siiHistory.map((s) => s.timestamp),
      axisLabel: {
        formatter: (value: string) => {
          const date = new Date(value);
          return `${date.getHours()}:00`;
        },
      },
    },
    yAxis: {
      type: "value",
      name: "SII",
      min: 0,
      max: 100,
    },
    series: [
      {
        type: "line",
        data: siiHistory.map((s) => s.sii),
        smooth: true,
        itemStyle: {
          color: "#10b981",
        },
      },
    ],
  };

  // Order book depth chart
  const orderBookOption = {
    tooltip: {
      trigger: "axis",
    },
    xAxis: {
      type: "value",
      name: "Price",
      axisLabel: {
        formatter: (value: number) => `${(value * 100).toFixed(1)}¢`,
      },
    },
    yAxis: {
      type: "value",
      name: "Cumulative Size",
    },
    series: [
      {
        name: "Bids",
        type: "line",
        data: orderBook.bids.map((b) => [b.price, b.total]),
        step: "end",
        itemStyle: {
          color: "#10b981",
        },
        areaStyle: {
          color: "rgba(16, 185, 129, 0.2)",
        },
      },
      {
        name: "Asks",
        type: "line",
        data: orderBook.asks.map((a) => [a.price, a.total]),
        step: "start",
        itemStyle: {
          color: "#ef4444",
        },
        areaStyle: {
          color: "rgba(239, 68, 68, 0.2)",
        },
      },
    ],
  };

  const getSIIColor = (sii: number) => {
    if (sii > 50) return "text-green-600 font-bold";
    if (sii > 0) return "text-green-500";
    if (sii > -50) return "text-red-500";
    return "text-red-600 font-bold";
  };

  const getRecommendationBadge = (rec: string) => {
    if (rec === "BUY_YES") return <Badge className="bg-green-600">BUY YES</Badge>;
    if (rec === "BUY_NO") return <Badge className="bg-red-600">BUY NO</Badge>;
    if (rec === "SELL") return <Badge className="bg-orange-600">SELL</Badge>;
    return <Badge variant="secondary">HOLD</Badge>;
  };

  const getTimeAgo = (timestamp: string) => {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor(diffMs / (1000 * 60));

    if (diffHours > 24) {
      const days = Math.floor(diffHours / 24);
      return `${days}d ago`;
    } else if (diffHours > 0) {
      return `${diffHours}h ago`;
    } else {
      return `${diffMins}m ago`;
    }
  };

  // Calculate smart money percentage
  const smartMoneyYes = yesHolders.filter(h => h.smart_score >= 70).length / yesHolders.length * 100;

  return (
    <div className="flex flex-col h-full space-y-6 p-6">
      {/* Market Title Section */}
      <div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-1">
            <h1 className="text-2xl font-bold">{market.title}</h1>
            <Badge>{market.category}</Badge>
          </div>
          {/* Navigation Button */}
          <Button variant="outline" asChild className="gap-2" size="sm">
            <Link href={`/events/${eventSlug}`}>
              <Calendar className="h-4 w-4" />
              View Event
            </Link>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{market.description}</p>
      </div>

      {/* Key Metrics Bar */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Current Price</div>
          <div className="text-2xl font-bold">{(market.current_price * 100).toFixed(1)}¢</div>
          <div className="text-xs text-green-600 flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            +2.4%
          </div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">SII Score</div>
          <div className={`text-2xl font-bold ${getSIIColor(market.sii)}`}>{market.sii}</div>
          <div className="text-xs text-muted-foreground">{(market.signal_confidence * 100).toFixed(0)}% conf</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">24h Volume</div>
          <div className="text-2xl font-bold">${(market.volume_24h / 1000000).toFixed(2)}M</div>
          <div className="text-xs text-muted-foreground">Total: ${(market.volume_total / 1000000).toFixed(1)}M</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Liquidity</div>
          <div className="text-2xl font-bold">${(market.liquidity_usd / 1000).toFixed(0)}k</div>
          <div className="text-xs text-muted-foreground">Spread: {market.spread_bps} bps</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Signal</div>
          <div className="text-sm">{getRecommendationBadge(market.signal_recommendation)}</div>
          <div className="text-xs text-muted-foreground">Edge: {market.edge_bp} bp</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Closes In</div>
          <div className="text-2xl font-bold">{market.hours_to_close}h</div>
          <div className="text-xs text-muted-foreground">{new Date(market.end_date).toLocaleDateString()}</div>
        </div>
      </div>

      {/* Hero Sentiment Section */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Market Sentiment Card */}
        <Card className="p-4">
          <div className="text-sm text-muted-foreground mb-2">Market Sentiment</div>
          <div className="flex items-center gap-4">
            <div className="text-2xl font-bold text-blue-600">
              YES {(market.current_price * 100).toFixed(0)}%
            </div>
            <div className="text-2xl font-bold text-amber-600">
              NO {((1 - market.current_price) * 100).toFixed(0)}%
            </div>
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            ↑ +12% (24h)
          </div>
        </Card>

        {/* Smart Money Position Card */}
        <Card className="p-4">
          <div className="text-sm text-muted-foreground mb-2">Smart Money Position</div>
          <div className="text-2xl font-bold">{smartMoneyYes.toFixed(0)}% YES</div>
          <div className="text-xs text-muted-foreground mt-2">
            High-WIS wallets favor YES
          </div>
        </Card>

        {/* Recent Momentum Card */}
        <Card className="p-4">
          <div className="text-sm text-muted-foreground mb-2">Recent Momentum</div>
          <div className="text-2xl font-bold text-green-600">↑ +12%</div>
          <div className="text-xs text-muted-foreground mt-2">
            24h price | +85% volume
          </div>
        </Card>

        {/* Signal Recommendation Card */}
        <Card className="p-4">
          <div className="text-sm text-muted-foreground mb-2">Signal</div>
          <Badge className="bg-green-600 text-lg">BUY YES</Badge>
          <div className="text-xs text-muted-foreground mt-2">
            {(market.signal_confidence * 100).toFixed(0)}% confidence
          </div>
        </Card>
      </div>

      {/* Price Chart */}
      <div className="border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Price History</h2>
          <div className="flex gap-1 border rounded-lg p-1">
            {(["1h", "24h", "7d", "30d"] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => setPriceTimeframe(tf)}
                className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                  priceTimeframe === tf
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {tf.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Current Prices */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="border rounded-lg p-3 bg-blue-50 dark:bg-blue-950/20">
            <div className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1">CURRENT YES PRICE</div>
            <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">
              {(market.current_price * 100).toFixed(1)}¢
            </div>
          </div>
          <div className="border rounded-lg p-3 bg-amber-50 dark:bg-amber-950/20">
            <div className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-1">CURRENT NO PRICE</div>
            <div className="text-2xl font-bold text-amber-700 dark:text-amber-300">
              {((1 - market.current_price) * 100).toFixed(1)}¢
            </div>
          </div>
        </div>

        <div className="h-[350px]">
          <ReactECharts
            option={priceChartOption}
            style={{ height: "100%", width: "100%" }}
            opts={{ renderer: "canvas" }}
          />
        </div>
      </div>

      {/* Position Analysis */}
      <div className="border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Position Analysis</h2>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <Card className="p-4">
            <div className="text-sm font-semibold text-blue-600 mb-2">YES SIDE</div>
            <div className="space-y-1 text-sm">
              <div>👥 {yesSummary.holders_count} holders</div>
              <div>💰 +${(yesSummary.profit_usd / 1000).toFixed(0)}k PnL</div>
              <div>📍 Avg: {(yesSummary.realized_price * 100).toFixed(0)}¢</div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm font-semibold text-amber-600 mb-2">NO SIDE</div>
            <div className="space-y-1 text-sm">
              <div>👥 {noSummary.holders_count} holders</div>
              <div>💰 ${(noSummary.loss_usd / 1000).toFixed(0)}k PnL</div>
              <div>📍 Avg: {(noSummary.realized_price * 100).toFixed(0)}¢</div>
            </div>
          </Card>
        </div>

        {/* Holders Tables - Side by Side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Top YES Holders - truncated to 3 */}
          <div>
            <h3 className="text-lg font-semibold mb-3">Top YES Holders</h3>
            <TruncatedTable
              data={yesHolders}
              initialRows={3}
              renderHeader={() => (
                <TableHeader>
                  <TableRow>
                    <TableHead>Wallet</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>PnL</TableHead>
                    <TableHead>Score</TableHead>
                  </TableRow>
                </TableHeader>
              )}
              renderRow={(holder) => (
                <TableRow key={holder.wallet_address}>
                  <TableCell>
                    <Link href={`/analysis/wallet/${holder.wallet_address}`} className="text-blue-600 hover:underline">
                      {holder.wallet_alias}
                    </Link>
                  </TableCell>
                  <TableCell>{holder.supply_pct.toFixed(1)}% | ${(holder.position_usd / 1000).toFixed(1)}k</TableCell>
                  <TableCell className={holder.pnl_total >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {holder.pnl_total >= 0 ? '+' : ''}${(holder.pnl_total / 1000).toFixed(1)}k
                  </TableCell>
                  <TableCell>
                    <Badge variant={holder.smart_score >= 80 ? 'default' : 'secondary'}>
                      {holder.smart_score}
                    </Badge>
                  </TableCell>
                </TableRow>
              )}
              expandText="Show All YES Holders"
            />
          </div>

          {/* Top NO Holders - truncated to 3 */}
          <div>
            <h3 className="text-lg font-semibold mb-3">Top NO Holders</h3>
            <TruncatedTable
              data={noHolders}
              initialRows={3}
              renderHeader={() => (
                <TableHeader>
                  <TableRow>
                    <TableHead>Wallet</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>PnL</TableHead>
                    <TableHead>Score</TableHead>
                  </TableRow>
                </TableHeader>
              )}
              renderRow={(holder) => (
                <TableRow key={holder.wallet_address}>
                  <TableCell>
                    <Link href={`/analysis/wallet/${holder.wallet_address}`} className="text-blue-600 hover:underline">
                      {holder.wallet_alias}
                    </Link>
                  </TableCell>
                  <TableCell>{holder.supply_pct.toFixed(1)}% | ${(holder.position_usd / 1000).toFixed(1)}k</TableCell>
                  <TableCell className={holder.pnl_total >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {holder.pnl_total >= 0 ? '+' : ''}${(holder.pnl_total / 1000).toFixed(1)}k
                  </TableCell>
                  <TableCell>
                    <Badge variant={holder.smart_score >= 80 ? 'default' : 'secondary'}>
                      {holder.smart_score}
                    </Badge>
                  </TableCell>
                </TableRow>
              )}
              expandText="Show All NO Holders"
            />
          </div>
        </div>
      </div>

      {/* Whale Activity */}
      <CollapsibleSection
        title="Recent Whale Activity"
        defaultExpanded={false}
        showCount={whaleTrades.length}
        compactView={
          <div className="space-y-2">
            {whaleTrades.slice(0, 5).map((trade) => (
              <div key={trade.trade_id} className="text-sm border-b pb-2">
                <span className={trade.side === 'YES' ? 'text-blue-600' : 'text-amber-600'}>
                  🐋 {trade.wallet_alias}
                </span>
                {' '}bought {(trade.shares / 1000).toFixed(0)}k {trade.side} @ {(trade.price * 100).toFixed(0)}¢
                <span className="text-muted-foreground ml-2">
                  ({getTimeAgo(trade.timestamp)})
                </span>
              </div>
            ))}
          </div>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Wallet</TableHead>
              <TableHead>WIS</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Side</TableHead>
              <TableHead>Shares</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Price</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {whaleTrades.map((trade) => (
              <TableRow key={trade.trade_id}>
                <TableCell>{getTimeAgo(trade.timestamp)}</TableCell>
                <TableCell>
                  <Link
                    href={`/analysis/wallet/${trade.wallet_address}`}
                    className="font-medium text-blue-600 hover:underline"
                  >
                    {trade.wallet_alias}
                  </Link>
                </TableCell>
                <TableCell className={trade.wis > 70 ? "text-green-600 font-bold" : ""}>{trade.wis}</TableCell>
                <TableCell>
                  <Badge variant={trade.action === "BUY" ? "default" : "secondary"}>
                    {trade.action}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={trade.side === "YES" ? "default" : "destructive"}>
                    {trade.side}
                  </Badge>
                </TableCell>
                <TableCell>{trade.shares.toLocaleString()}</TableCell>
                <TableCell>${trade.amount_usd.toLocaleString()}</TableCell>
                <TableCell>{(trade.price * 100).toFixed(1)}¢</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CollapsibleSection>

      {/* SII Trend + Signal Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* SII Trend */}
        <div className="border rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-4">SII Trend (48 Hours)</h2>
          <div className="h-[250px]">
            <ReactECharts option={siiChartOption} style={{ height: '100%' }} />
          </div>
        </div>

        {/* Signal Breakdown */}
        <div className="border rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-4">Signal Breakdown</h2>
          <div className="space-y-3">
            <SignalComponent
              name="PSP Ensemble"
              weight={signalBreakdown.psp_weight}
              contribution={signalBreakdown.psp_contribution}
              confidence={signalBreakdown.psp_confidence}
            />
            <SignalComponent
              name="Crowd Wisdom"
              weight={signalBreakdown.crowd_weight}
              contribution={signalBreakdown.crowd_contribution}
              confidence={signalBreakdown.crowd_confidence}
            />
            <SignalComponent
              name="Momentum"
              weight={signalBreakdown.momentum_weight}
              contribution={signalBreakdown.momentum_contribution}
              confidence={signalBreakdown.momentum_confidence}
            />
            <SignalComponent
              name="Microstructure"
              weight={signalBreakdown.microstructure_weight}
              contribution={signalBreakdown.microstructure_contribution}
              confidence={signalBreakdown.microstructure_confidence}
            />
          </div>
        </div>
      </div>

      {/* Order Book - Compact */}
      <CollapsibleSection
        title="Order Book"
        defaultExpanded={false}
        compactView={
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm font-semibold text-green-600 mb-2">Top 5 Bids</div>
              <div className="space-y-1 text-sm">
                {orderBook.bids.slice(0, 5).map((bid, i) => (
                  <div key={i} className="flex justify-between">
                    <span className="font-medium">{(bid.price * 100).toFixed(2)}¢</span>
                    <span className="text-muted-foreground">{bid.size.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-sm font-semibold text-red-600 mb-2">Top 5 Asks</div>
              <div className="space-y-1 text-sm">
                {orderBook.asks.slice(0, 5).map((ask, i) => (
                  <div key={i} className="flex justify-between">
                    <span className="font-medium">{(ask.price * 100).toFixed(2)}¢</span>
                    <span className="text-muted-foreground">{ask.size.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        }
      >
        {/* Depth Chart */}
        <div className="mb-4">
          <h3 className="text-md font-semibold mb-3">Order Book Depth</h3>
          <div className="h-[300px]">
            <ReactECharts
              option={orderBookOption}
              style={{ height: "100%", width: "100%" }}
              opts={{ renderer: "canvas" }}
            />
          </div>
        </div>

        {/* Order Book Tables */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h4 className="text-sm font-semibold mb-3 text-green-600">All Bids</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Price</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderBook.bids.map((bid, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{(bid.price * 100).toFixed(2)}¢</TableCell>
                    <TableCell>{bid.size.toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground">{bid.total.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-3 text-red-600">All Asks</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Price</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderBook.asks.map((ask, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{(ask.price * 100).toFixed(2)}¢</TableCell>
                    <TableCell>{ask.size.toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground">{ask.total.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </CollapsibleSection>

      {/* Advanced Analytics - OHLC Chart */}
      <CollapsibleSection
        title="OHLC Candlestick Chart"
        defaultExpanded={false}
        compactView={
          <div className="text-sm text-muted-foreground">
            View detailed candlestick chart with 4-hour intervals over the past 7 days
          </div>
        }
      >
        <div className="h-[500px]">
          <ReactECharts
            option={{
              tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' },
              },
              xAxis: {
                type: 'category',
                data: ohlcData.map((d) => new Date(d.timestamp).toLocaleString()),
                axisLabel: {
                  formatter: (value: string) => {
                    const date = new Date(value);
                    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:00`;
                  },
                },
              },
              yAxis: {
                type: 'value',
                name: 'Price',
                axisLabel: {
                  formatter: (value: number) => `${(value * 100).toFixed(0)}¢`,
                },
              },
              series: [
                {
                  type: 'candlestick',
                  data: ohlcData.map((d) => [d.open, d.close, d.low, d.high]),
                  itemStyle: {
                    color: '#10b981',
                    color0: '#ef4444',
                    borderColor: '#10b981',
                    borderColor0: '#ef4444',
                  },
                },
              ],
            }}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
        </div>
      </CollapsibleSection>

      {/* Market Information */}
      <div className="border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
          <Info className="h-5 w-5" />
          Market Information
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left Column - Key Stats */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">Start Date</p>
                <p className="text-sm font-semibold">{new Date(marketData.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">End Date</p>
                <p className="text-sm font-semibold">{new Date(market.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">Liquidity</p>
                <p className="text-sm font-semibold">${(market.liquidity_usd / 1000).toFixed(1)}k</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">24h Volume</p>
                <p className="text-sm font-semibold">${(market.volume_24h / 1000).toFixed(1)}k</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Users className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">Traders</p>
                <p className="text-sm font-semibold">{marketData.tradersCount.toLocaleString()}</p>
              </div>
            </div>

            {/* Polymarket Link */}
            <Button variant="outline" className="w-full gap-2" asChild>
              <a href={marketData.polymarketUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                View on Polymarket
              </a>
            </Button>
          </div>

          {/* Right Column - Rules */}
          <div>
            <h3 className="text-sm font-semibold mb-3">Rules</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {marketData.rules}
            </p>
          </div>
        </div>
      </div>

      {/* Related Markets - At the bottom, only 3 cards */}
      <div className="border rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-4">Related Markets</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {relatedMarkets.map((rm) => (
            <Link
              key={rm.market_id}
              href={`/analysis/market/${rm.market_id}`}
              className="border rounded-lg p-4 hover:bg-accent transition-colors cursor-pointer"
            >
              <h3 className="font-medium text-sm mb-3 line-clamp-2">{rm.title}</h3>
              <div className="flex gap-2 mb-3">
                {rm.outcome_chips.map((chip) => (
                  <Badge
                    key={chip.side}
                    variant={chip.side === "YES" ? "default" : "destructive"}
                    className="text-xs"
                  >
                    {chip.side} {(chip.price * 100).toFixed(0)}¢
                  </Badge>
                ))}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Vol: ${(rm.volume_24h / 1000).toFixed(0)}k</span>
                <span>Liq: ${(rm.liquidity / 1000).toFixed(0)}k</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function SignalComponent({
  name,
  weight,
  contribution,
  confidence,
}: {
  name: string;
  weight: number;
  contribution: number;
  confidence: number;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm font-medium">{name}</span>
        <span className="text-xs text-muted-foreground">{(weight * 100).toFixed(0)}% weight</span>
      </div>
      <div className="flex gap-2 items-center">
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary"
            style={{ width: `${contribution * 100}%` }}
          />
        </div>
        <span className="text-xs font-medium">{(confidence * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}
