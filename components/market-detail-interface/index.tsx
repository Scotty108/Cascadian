"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ReactECharts from "echarts-for-react";
import { ArrowLeft, TrendingUp, TrendingDown, Clock, DollarSign, Activity, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  MarketDetail as MarketDetailType,
  PriceHistoryPoint,
  SignalBreakdown,
  WhaleTradeForMarket,
  SmartWalletPosition,
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
  const [selectedTab, setSelectedTab] = useState("overview");

  // Mock data - will be replaced with API call
  const market: MarketDetailType = {
    market_id: marketId,
    title: "Will Trump win the 2024 Presidential Election?",
    description: "This market will resolve to YES if Donald Trump wins the 2024 US Presidential Election and becomes the 47th President of the United States. The market will resolve based on official election results certified by Congress.",
    category: "Politics",
    outcome: "YES",
    current_price: 0.63,
    bid: 0.6295,
    ask: 0.6305,
    spread_bps: 10,
    volume_24h: 2450000,
    volume_total: 45000000,
    liquidity_usd: 850000,
    end_date: "2024-11-05T23:59:59Z",
    hours_to_close: 168,
    active: true,
    sii: 75,
    momentum: 82,
    signal_confidence: 0.85,
    signal_recommendation: "BUY_YES",
    edge_bp: 150,
  };

  const signalBreakdown: SignalBreakdown = {
    psp_weight: 0.40,
    psp_contribution: 0.68,
    psp_confidence: 0.88,
    crowd_weight: 0.30,
    crowd_contribution: 0.72,
    crowd_confidence: 0.85,
    momentum_weight: 0.20,
    momentum_contribution: 0.65,
    momentum_confidence: 0.82,
    microstructure_weight: 0.10,
    microstructure_contribution: 0.70,
    microstructure_confidence: 0.78,
  };

  // Price history (7 days)
  const priceHistory: PriceHistoryPoint[] = Array.from({ length: 168 }, (_, i) => ({
    timestamp: new Date(Date.now() - (168 - i) * 3600000).toISOString(),
    price: 0.55 + Math.sin(i / 10) * 0.05 + (i / 168) * 0.08,
    volume: 10000 + Math.random() * 20000,
  }));

  // SII history
  const siiHistory: SIIHistoryPoint[] = Array.from({ length: 48 }, (_, i) => ({
    timestamp: new Date(Date.now() - (48 - i) * 3600000).toISOString(),
    sii: 60 + Math.sin(i / 5) * 10 + (i / 48) * 15,
    confidence: 0.75 + Math.random() * 0.15,
  }));

  // Whale trades
  const whaleTrades: WhaleTradeForMarket[] = [
    {
      trade_id: "1",
      timestamp: "2025-10-20T14:32:00Z",
      wallet_address: "0x1a2b3c",
      wallet_alias: "WhaleTrader42",
      wis: 85,
      side: "YES",
      action: "BUY",
      shares: 50000,
      amount_usd: 31500,
      price: 0.63,
    },
    {
      trade_id: "2",
      timestamp: "2025-10-20T13:15:00Z",
      wallet_address: "0x4d5e6f",
      wallet_alias: "SmartInvestor",
      wis: 91,
      side: "YES",
      action: "BUY",
      shares: 35000,
      amount_usd: 22050,
      price: 0.63,
    },
    {
      trade_id: "3",
      timestamp: "2025-10-20T12:45:00Z",
      wallet_address: "0x7g8h9i",
      wallet_alias: "ContraCaptain",
      wis: 72,
      side: "NO",
      action: "BUY",
      shares: 20000,
      amount_usd: 7400,
      price: 0.37,
    },
  ];

  // Smart wallet positions
  const smartPositions: SmartWalletPosition[] = [
    {
      wallet_address: "0x1a2b3c",
      wallet_alias: "WhaleTrader42",
      wis: 85,
      position_side: "YES",
      shares: 150000,
      avg_entry_price: 0.61,
      current_value_usd: 94500,
      unrealized_pnl_usd: 3000,
      unrealized_pnl_pct: 3.28,
    },
    {
      wallet_address: "0xjklmno",
      wallet_alias: "SmartInvestor",
      wis: 91,
      position_side: "YES",
      shares: 200000,
      avg_entry_price: 0.59,
      current_value_usd: 126000,
      unrealized_pnl_usd: 8000,
      unrealized_pnl_pct: 6.78,
    },
  ];

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

  // Related markets
  const relatedMarkets: RelatedMarket[] = [
    {
      market_id: "biden-2024",
      title: "Will Biden win the 2024 Presidential Election?",
      outcome_chips: [
        { side: "YES", price: 0.37 },
        { side: "NO", price: 0.63 },
      ],
      volume_24h: 1850000,
      liquidity: 620000,
    },
    {
      market_id: "dem-nominee-2024",
      title: "Will Harris be the Democratic nominee?",
      outcome_chips: [
        { side: "YES", price: 0.92 },
        { side: "NO", price: 0.08 },
      ],
      volume_24h: 980000,
      liquidity: 450000,
    },
    {
      market_id: "popular-vote-2024",
      title: "Will Trump win the popular vote?",
      outcome_chips: [
        { side: "YES", price: 0.48 },
        { side: "NO", price: 0.52 },
      ],
      volume_24h: 1250000,
      liquidity: 520000,
    },
    {
      market_id: "swing-states-2024",
      title: "Will Trump win Pennsylvania?",
      outcome_chips: [
        { side: "YES", price: 0.61 },
        { side: "NO", price: 0.39 },
      ],
      volume_24h: 2100000,
      liquidity: 780000,
    },
    {
      market_id: "debate-winner-2024",
      title: "Who will win the final debate?",
      outcome_chips: [
        { side: "YES", price: 0.55 },
        { side: "NO", price: 0.45 },
      ],
      volume_24h: 650000,
      liquidity: 290000,
    },
    {
      market_id: "electoral-college-2024",
      title: "Will Trump get 300+ electoral votes?",
      outcome_chips: [
        { side: "YES", price: 0.42 },
        { side: "NO", price: 0.58 },
      ],
      volume_24h: 890000,
      liquidity: 380000,
    },
  ];

  // YES side holders
  const yesHolders: HolderPosition[] = [
    {
      wallet_address: "0x1a2b3c",
      wallet_alias: "WhaleTrader42",
      position_usd: 125000,
      pnl_total: 15000,
      supply_pct: 12.5,
      avg_entry: 0.58,
      realized_pnl: 8000,
      unrealized_pnl: 7000,
      smart_score: 85,
      last_action_time: "2025-10-20T14:32:00Z",
    },
    {
      wallet_address: "0x4d5e6f",
      wallet_alias: "SmartInvestor",
      position_usd: 89000,
      pnl_total: 12500,
      supply_pct: 8.9,
      avg_entry: 0.59,
      realized_pnl: 5000,
      unrealized_pnl: 7500,
      smart_score: 91,
      last_action_time: "2025-10-20T13:15:00Z",
    },
    {
      wallet_address: "0x7g8h9i",
      wallet_alias: "MomentumMaster",
      position_usd: 67000,
      pnl_total: 9200,
      supply_pct: 6.7,
      avg_entry: 0.60,
      realized_pnl: 3200,
      unrealized_pnl: 6000,
      smart_score: 68,
      last_action_time: "2025-10-19T18:45:00Z",
    },
  ];

  const yesSummary: HoldersSummary = {
    side: "YES",
    holders_count: 156,
    profit_usd: 425000,
    loss_usd: -85000,
    realized_price: 0.61,
  };

  // NO side holders
  const noHolders: HolderPosition[] = [
    {
      wallet_address: "0xpqrstu",
      wallet_alias: "ContraCaptain",
      position_usd: 78000,
      pnl_total: -8500,
      supply_pct: 10.2,
      avg_entry: 0.42,
      realized_pnl: -2000,
      unrealized_pnl: -6500,
      smart_score: 72,
      last_action_time: "2025-10-20T12:45:00Z",
    },
    {
      wallet_address: "0xvwxyz1",
      wallet_alias: "BearishBob",
      position_usd: 52000,
      pnl_total: -5200,
      supply_pct: 6.8,
      avg_entry: 0.40,
      realized_pnl: -1500,
      unrealized_pnl: -3700,
      smart_score: 45,
      last_action_time: "2025-10-19T16:20:00Z",
    },
    {
      wallet_address: "0xabc123",
      wallet_alias: "SkepticalSam",
      position_usd: 38000,
      pnl_total: -3800,
      supply_pct: 5.0,
      avg_entry: 0.41,
      realized_pnl: -1000,
      unrealized_pnl: -2800,
      smart_score: 52,
      last_action_time: "2025-10-18T22:10:00Z",
    },
  ];

  const noSummary: HoldersSummary = {
    side: "NO",
    holders_count: 98,
    profit_usd: 120000,
    loss_usd: -285000,
    realized_price: 0.39,
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

  // Price chart option
  const priceChartOption = {
    tooltip: {
      trigger: "axis",
      formatter: (params: any) => {
        const data = params[0];
        return `
          <div style="padding: 8px;">
            <div><strong>${new Date(data.name).toLocaleString()}</strong></div>
            <div style="margin-top: 4px;">
              Price: <strong>${(data.value * 100).toFixed(1)}¢</strong>
            </div>
          </div>
        `;
      },
    },
    xAxis: {
      type: "category",
      data: priceHistory.map((p) => p.timestamp),
      axisLabel: {
        formatter: (value: string) => {
          const date = new Date(value);
          return `${date.getMonth() + 1}/${date.getDate()}`;
        },
      },
    },
    yAxis: {
      type: "value",
      name: "Price",
      axisLabel: {
        formatter: (value: number) => `${(value * 100).toFixed(0)}¢`,
      },
      min: 0.5,
      max: 0.7,
    },
    series: [
      {
        type: "line",
        data: priceHistory.map((p) => p.price),
        smooth: true,
        itemStyle: {
          color: "#3b82f6",
        },
        areaStyle: {
          color: "rgba(59, 130, 246, 0.1)",
        },
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

  return (
    <div className="flex flex-col h-full space-y-4 p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{market.title}</h1>
            <Badge>{market.category}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{market.description}</p>
        </div>
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

      {/* Tabs */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="flex-1">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="holders">Holders</TabsTrigger>
          <TabsTrigger value="ohlc">OHLC Chart</TabsTrigger>
          <TabsTrigger value="whales">Whale Activity</TabsTrigger>
          <TabsTrigger value="positions">Smart Positions</TabsTrigger>
          <TabsTrigger value="orderbook">Order Book</TabsTrigger>
          <TabsTrigger value="trade">Trade</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          {/* Price Chart */}
          <div className="border rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-4">Price History (7 Days)</h2>
            <div className="h-[300px]">
              <ReactECharts
                option={priceChartOption}
                style={{ height: "100%", width: "100%" }}
                opts={{ renderer: "canvas" }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* SII Chart */}
            <div className="border rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-4">SII Trend (48 Hours)</h2>
              <div className="h-[250px]">
                <ReactECharts
                  option={siiChartOption}
                  style={{ height: "100%", width: "100%" }}
                  opts={{ renderer: "canvas" }}
                />
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

          {/* Related Markets */}
          <div className="border rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-4">Related Markets</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
        </TabsContent>

        {/* Holders Tab */}
        <TabsContent value="holders" className="space-y-4">
          {/* YES Holders */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">YES Holders ({yesSummary.holders_count})</h2>
              <div className="flex gap-4 text-sm">
                <span className="text-green-600 font-bold">
                  Profit: +${(yesSummary.profit_usd / 1000).toFixed(0)}k
                </span>
                <span className="text-red-600 font-bold">
                  Loss: ${(yesSummary.loss_usd / 1000).toFixed(0)}k
                </span>
                <span className="text-muted-foreground">
                  Realized: {(yesSummary.realized_price * 100).toFixed(0)}¢
                </span>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Wallet</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Supply %</TableHead>
                  <TableHead>Avg Entry</TableHead>
                  <TableHead>Total PnL</TableHead>
                  <TableHead>Realized</TableHead>
                  <TableHead>Unrealized</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Last Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {yesHolders.map((holder) => (
                  <TableRow key={holder.wallet_address}>
                    <TableCell>
                      <Link
                        href={`/analysis/wallet/${holder.wallet_address}`}
                        className="text-blue-600 hover:underline"
                      >
                        {holder.wallet_alias}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">
                      ${(holder.position_usd / 1000).toFixed(1)}k
                    </TableCell>
                    <TableCell>{holder.supply_pct.toFixed(1)}%</TableCell>
                    <TableCell>{(holder.avg_entry * 100).toFixed(0)}¢</TableCell>
                    <TableCell className={holder.pnl_total >= 0 ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                      {holder.pnl_total >= 0 ? "+" : ""}${(holder.pnl_total / 1000).toFixed(1)}k
                    </TableCell>
                    <TableCell className="text-xs">
                      ${(holder.realized_pnl / 1000).toFixed(1)}k
                    </TableCell>
                    <TableCell className="text-xs">
                      ${(holder.unrealized_pnl / 1000).toFixed(1)}k
                    </TableCell>
                    <TableCell>
                      <Badge variant={holder.smart_score >= 80 ? "default" : "secondary"}>
                        {holder.smart_score}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(holder.last_action_time).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* NO Holders */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">NO Holders ({noSummary.holders_count})</h2>
              <div className="flex gap-4 text-sm">
                <span className="text-green-600 font-bold">
                  Profit: +${(noSummary.profit_usd / 1000).toFixed(0)}k
                </span>
                <span className="text-red-600 font-bold">
                  Loss: ${(noSummary.loss_usd / 1000).toFixed(0)}k
                </span>
                <span className="text-muted-foreground">
                  Realized: {(noSummary.realized_price * 100).toFixed(0)}¢
                </span>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Wallet</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Supply %</TableHead>
                  <TableHead>Avg Entry</TableHead>
                  <TableHead>Total PnL</TableHead>
                  <TableHead>Realized</TableHead>
                  <TableHead>Unrealized</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Last Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {noHolders.map((holder) => (
                  <TableRow key={holder.wallet_address}>
                    <TableCell>
                      <Link
                        href={`/analysis/wallet/${holder.wallet_address}`}
                        className="text-blue-600 hover:underline"
                      >
                        {holder.wallet_alias}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">
                      ${(holder.position_usd / 1000).toFixed(1)}k
                    </TableCell>
                    <TableCell>{holder.supply_pct.toFixed(1)}%</TableCell>
                    <TableCell>{(holder.avg_entry * 100).toFixed(0)}¢</TableCell>
                    <TableCell className={holder.pnl_total >= 0 ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                      {holder.pnl_total >= 0 ? "+" : ""}${(holder.pnl_total / 1000).toFixed(1)}k
                    </TableCell>
                    <TableCell className="text-xs">
                      ${(holder.realized_pnl / 1000).toFixed(1)}k
                    </TableCell>
                    <TableCell className="text-xs">
                      ${(holder.unrealized_pnl / 1000).toFixed(1)}k
                    </TableCell>
                    <TableCell>
                      <Badge variant={holder.smart_score >= 80 ? "default" : "secondary"}>
                        {holder.smart_score}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(holder.last_action_time).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* OHLC Chart Tab */}
        <TabsContent value="ohlc" className="space-y-4">
          <div className="border rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-4">OHLC Candlestick Chart (7 Days)</h2>
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
          </div>
        </TabsContent>

        {/* Whale Activity Tab */}
        <TabsContent value="whales">
          <div className="border rounded-lg overflow-auto">
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
                    <TableCell>{new Date(trade.timestamp).toLocaleTimeString()}</TableCell>
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
          </div>
        </TabsContent>

        {/* Smart Positions Tab */}
        <TabsContent value="positions">
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Wallet</TableHead>
                  <TableHead>WIS</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Shares</TableHead>
                  <TableHead>Avg Entry</TableHead>
                  <TableHead>Current Value</TableHead>
                  <TableHead>PnL ($)</TableHead>
                  <TableHead>PnL (%)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {smartPositions.map((pos) => (
                  <TableRow key={pos.wallet_address}>
                    <TableCell>
                      <Link
                        href={`/analysis/wallet/${pos.wallet_address}`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {pos.wallet_alias}
                      </Link>
                    </TableCell>
                    <TableCell className="text-green-600 font-bold">{pos.wis}</TableCell>
                    <TableCell>
                      <Badge variant={pos.position_side === "YES" ? "default" : "destructive"}>
                        {pos.position_side}
                      </Badge>
                    </TableCell>
                    <TableCell>{pos.shares.toLocaleString()}</TableCell>
                    <TableCell>{(pos.avg_entry_price * 100).toFixed(1)}¢</TableCell>
                    <TableCell>${pos.current_value_usd.toLocaleString()}</TableCell>
                    <TableCell className={pos.unrealized_pnl_usd > 0 ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                      ${pos.unrealized_pnl_usd.toLocaleString()}
                    </TableCell>
                    <TableCell className={pos.unrealized_pnl_pct > 0 ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                      {pos.unrealized_pnl_pct > 0 ? "+" : ""}{pos.unrealized_pnl_pct.toFixed(2)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Order Book Tab */}
        <TabsContent value="orderbook" className="space-y-4">
          {/* Depth Chart */}
          <div className="border rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-4">Order Book Depth</h2>
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
            <div className="border rounded-lg p-4">
              <h3 className="text-md font-semibold mb-3 text-green-600">Bids</h3>
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

            <div className="border rounded-lg p-4">
              <h3 className="text-md font-semibold mb-3 text-red-600">Asks</h3>
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
        </TabsContent>

        {/* Trade Tab */}
        <TabsContent value="trade">
          <div className="border rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Trading Interface</h2>
            <div className="bg-muted/50 rounded-lg p-8 text-center">
              <DollarSign className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">Trading Coming Soon</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Connect your wallet and configure strategies to start trading on this market.
              </p>
              <div className="flex gap-2 justify-center">
                <Button variant="default">
                  Connect Wallet
                </Button>
                <Button variant="outline" onClick={() => router.push("/strategy-builder")}>
                  Create Strategy
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
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
