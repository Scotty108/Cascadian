"use client";

import { useState, useMemo, useRef } from "react";
import Link from "next/link";
import { ArrowUpDown, Star, Filter, X, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MarketScreenerRow } from "./types";

// Time window options
type TimeWindow = '24h' | '12h' | '6h' | '1h' | '10m';

// Filter state interface
interface FilterState {
  categories: string[];
  outcomes: string[];
  priceRange: [number, number];
  volumeRange: [number, number];
  tradesRange: [number, number];
  buyersRange: [number, number];
  sellersRange: [number, number];
  siiRange: [number, number];
  whalePressureRange: [number, number];
  smartPressureRange: [number, number];
}

export function MarketScreener() {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<keyof MarketScreenerRow>("sii");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('24h');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{ marketId: string; column: string } | null>(null);

  // Ref for scroll container
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Filter state
  const [filters, setFilters] = useState<FilterState>({
    categories: [],
    outcomes: [],
    priceRange: [0.01, 0.99],
    volumeRange: [0, 250000],
    tradesRange: [0, 1000],
    buyersRange: [0, 500],
    sellersRange: [0, 500],
    siiRange: [-100, 100],
    whalePressureRange: [-100000, 100000],
    smartPressureRange: [-100000, 100000],
  });

  // Available categories
  const availableCategories = ['Sports', 'Politics', 'Crypto', 'Technology', 'Finance', 'Pop Culture', 'Other', 'Music', 'Weather'];

  // Mock data - will be replaced with API call
  const markets: MarketScreenerRow[] = [
    {
      market_id: "1",
      title: "Will Trump win the 2024 election?",
      outcome: "YES",
      last_price: 0.63,
      price_delta: 2.4,
      volume_24h: 125000,
      trades_24h: 450,
      buyers_24h: 180,
      sellers_24h: 120,
      unique_addresses_24h: 285,
      whale_buys_24h: 12,
      whale_sells_24h: 8,
      whale_volume_buy_24h: 45000,
      whale_volume_sell_24h: 28000,
      whale_pressure: 17000,
      whale_buy_sell_ratio: 1.61,
      buy_sell_ratio: 1.5,
      volatility: 0.15,
      spread_bps: 25,
      smart_buyers_24h: 35,
      smart_sellers_24h: 22,
      smart_volume_buy_24h: 62000,
      smart_volume_sell_24h: 38000,
      smart_buy_sell_ratio: 1.59,
      smart_pressure: 24000,
      sii: 75,
      momentum: 82,
      category: "Politics",
    },
    {
      market_id: "2",
      title: "Will Bitcoin reach $100k by end of 2024?",
      outcome: "YES",
      last_price: 0.28,
      price_delta: -3.2,
      volume_24h: 89000,
      trades_24h: 320,
      buyers_24h: 95,
      sellers_24h: 150,
      unique_addresses_24h: 230,
      whale_buys_24h: 6,
      whale_sells_24h: 14,
      whale_volume_buy_24h: 22000,
      whale_volume_sell_24h: 48000,
      whale_pressure: -26000,
      whale_buy_sell_ratio: 0.46,
      buy_sell_ratio: 0.63,
      volatility: 0.22,
      spread_bps: 35,
      smart_buyers_24h: 18,
      smart_sellers_24h: 42,
      smart_volume_buy_24h: 28000,
      smart_volume_sell_24h: 54000,
      smart_buy_sell_ratio: 0.43,
      smart_pressure: -26000,
      sii: -45,
      momentum: 35,
      category: "Crypto",
    },
    {
      market_id: "3",
      title: "Will Lakers win NBA Championship 2025?",
      outcome: "YES",
      last_price: 0.42,
      price_delta: 1.8,
      volume_24h: 45000,
      trades_24h: 210,
      buyers_24h: 110,
      sellers_24h: 95,
      unique_addresses_24h: 195,
      whale_buys_24h: 8,
      whale_sells_24h: 7,
      whale_volume_buy_24h: 18000,
      whale_volume_sell_24h: 16000,
      whale_pressure: 2000,
      whale_buy_sell_ratio: 1.13,
      buy_sell_ratio: 1.16,
      volatility: 0.18,
      spread_bps: 30,
      smart_buyers_24h: 24,
      smart_sellers_24h: 21,
      smart_volume_buy_24h: 22000,
      smart_volume_sell_24h: 19000,
      smart_buy_sell_ratio: 1.14,
      smart_pressure: 3000,
      sii: 12,
      momentum: 58,
      category: "Sports",
    },
    {
      market_id: "4",
      title: "Will Ethereum reach $5000 in 2025?",
      outcome: "YES",
      last_price: 0.52,
      price_delta: 4.1,
      volume_24h: 210000,
      trades_24h: 680,
      buyers_24h: 290,
      sellers_24h: 185,
      unique_addresses_24h: 445,
      whale_buys_24h: 22,
      whale_sells_24h: 11,
      whale_volume_buy_24h: 82000,
      whale_volume_sell_24h: 38000,
      whale_pressure: 44000,
      whale_buy_sell_ratio: 2.16,
      buy_sell_ratio: 1.57,
      volatility: 0.19,
      spread_bps: 22,
      smart_buyers_24h: 48,
      smart_sellers_24h: 28,
      smart_volume_buy_24h: 95000,
      smart_volume_sell_24h: 52000,
      smart_buy_sell_ratio: 1.71,
      smart_pressure: 43000,
      sii: 68,
      momentum: 76,
      category: "Crypto",
    },
    {
      market_id: "5",
      title: "Will S&P 500 reach 6000 by year end?",
      outcome: "YES",
      last_price: 0.71,
      price_delta: -1.2,
      volume_24h: 156000,
      trades_24h: 420,
      buyers_24h: 165,
      sellers_24h: 205,
      unique_addresses_24h: 345,
      whale_buys_24h: 14,
      whale_sells_24h: 18,
      whale_volume_buy_24h: 52000,
      whale_volume_sell_24h: 68000,
      whale_pressure: -16000,
      whale_buy_sell_ratio: 0.78,
      buy_sell_ratio: 0.80,
      volatility: 0.12,
      spread_bps: 18,
      smart_buyers_24h: 32,
      smart_sellers_24h: 45,
      smart_volume_buy_24h: 58000,
      smart_volume_sell_24h: 72000,
      smart_buy_sell_ratio: 0.71,
      smart_pressure: -14000,
      sii: -28,
      momentum: 42,
      category: "Finance",
    },
    {
      market_id: "6",
      title: "Will Taylor Swift win Grammy Album of the Year?",
      outcome: "YES",
      last_price: 0.38,
      price_delta: 0.5,
      volume_24h: 32000,
      trades_24h: 165,
      buyers_24h: 88,
      sellers_24h: 72,
      unique_addresses_24h: 148,
      whale_buys_24h: 5,
      whale_sells_24h: 4,
      whale_volume_buy_24h: 12000,
      whale_volume_sell_24h: 9500,
      whale_pressure: 2500,
      whale_buy_sell_ratio: 1.25,
      buy_sell_ratio: 1.22,
      volatility: 0.21,
      spread_bps: 40,
      smart_buyers_24h: 16,
      smart_sellers_24h: 13,
      smart_volume_buy_24h: 14500,
      smart_volume_sell_24h: 11000,
      smart_buy_sell_ratio: 1.23,
      smart_pressure: 3500,
      sii: 22,
      momentum: 61,
      category: "Pop Culture",
    },
    {
      market_id: "7",
      title: "Will OpenAI release GPT-5 in 2025?",
      outcome: "YES",
      last_price: 0.65,
      price_delta: 6.8,
      volume_24h: 178000,
      trades_24h: 520,
      buyers_24h: 285,
      sellers_24h: 145,
      unique_addresses_24h: 398,
      whale_buys_24h: 28,
      whale_sells_24h: 9,
      whale_volume_buy_24h: 92000,
      whale_volume_sell_24h: 32000,
      whale_pressure: 60000,
      whale_buy_sell_ratio: 3.11,
      buy_sell_ratio: 1.97,
      volatility: 0.24,
      spread_bps: 28,
      smart_buyers_24h: 52,
      smart_sellers_24h: 18,
      smart_volume_buy_24h: 105000,
      smart_volume_sell_24h: 38000,
      smart_buy_sell_ratio: 2.89,
      smart_pressure: 67000,
      sii: 82,
      momentum: 88,
      category: "Technology",
    },
    {
      market_id: "8",
      title: "Will Biden run for reelection in 2028?",
      outcome: "NO",
      last_price: 0.18,
      price_delta: -2.8,
      volume_24h: 68000,
      trades_24h: 245,
      buyers_24h: 72,
      sellers_24h: 158,
      unique_addresses_24h: 215,
      whale_buys_24h: 4,
      whale_sells_24h: 15,
      whale_volume_buy_24h: 14000,
      whale_volume_sell_24h: 42000,
      whale_pressure: -28000,
      whale_buy_sell_ratio: 0.27,
      buy_sell_ratio: 0.46,
      volatility: 0.16,
      spread_bps: 32,
      smart_buyers_24h: 11,
      smart_sellers_24h: 38,
      smart_volume_buy_24h: 18000,
      smart_volume_sell_24h: 48000,
      smart_buy_sell_ratio: 0.29,
      smart_pressure: -30000,
      sii: -62,
      momentum: 28,
      category: "Politics",
    },
    {
      market_id: "9",
      title: "Will Manchester City win Premier League 2024-25?",
      outcome: "YES",
      last_price: 0.58,
      price_delta: 1.4,
      volume_24h: 92000,
      trades_24h: 315,
      buyers_24h: 175,
      sellers_24h: 125,
      unique_addresses_24h: 278,
      whale_buys_24h: 11,
      whale_sells_24h: 8,
      whale_volume_buy_24h: 38000,
      whale_volume_sell_24h: 26000,
      whale_pressure: 12000,
      whale_buy_sell_ratio: 1.38,
      buy_sell_ratio: 1.40,
      volatility: 0.14,
      spread_bps: 24,
      smart_buyers_24h: 28,
      smart_sellers_24h: 19,
      smart_volume_buy_24h: 42000,
      smart_volume_sell_24h: 28000,
      smart_buy_sell_ratio: 1.47,
      smart_pressure: 14000,
      sii: 38,
      momentum: 68,
      category: "Sports",
    },
    {
      market_id: "10",
      title: "Will Solana flip Ethereum by market cap?",
      outcome: "NO",
      last_price: 0.15,
      price_delta: -5.2,
      volume_24h: 134000,
      trades_24h: 485,
      buyers_24h: 125,
      sellers_24h: 285,
      unique_addresses_24h: 388,
      whale_buys_24h: 8,
      whale_sells_24h: 24,
      whale_volume_buy_24h: 28000,
      whale_volume_sell_24h: 78000,
      whale_pressure: -50000,
      whale_buy_sell_ratio: 0.33,
      buy_sell_ratio: 0.44,
      volatility: 0.28,
      spread_bps: 45,
      smart_buyers_24h: 15,
      smart_sellers_24h: 52,
      smart_volume_buy_24h: 32000,
      smart_volume_sell_24h: 88000,
      smart_buy_sell_ratio: 0.29,
      smart_pressure: -56000,
      sii: -71,
      momentum: 22,
      category: "Crypto",
    },
    {
      market_id: "11",
      title: "Will Tesla stock reach $500 in 2025?",
      outcome: "YES",
      last_price: 0.45,
      price_delta: 3.2,
      volume_24h: 98000,
      trades_24h: 365,
      buyers_24h: 195,
      sellers_24h: 155,
      unique_addresses_24h: 325,
      whale_buys_24h: 16,
      whale_sells_24h: 10,
      whale_volume_buy_24h: 42000,
      whale_volume_sell_24h: 28000,
      whale_pressure: 14000,
      whale_buy_sell_ratio: 1.60,
      buy_sell_ratio: 1.26,
      volatility: 0.20,
      spread_bps: 26,
      smart_buyers_24h: 36,
      smart_sellers_24h: 24,
      smart_volume_buy_24h: 48000,
      smart_volume_sell_24h: 32000,
      smart_buy_sell_ratio: 1.50,
      smart_pressure: 16000,
      sii: 44,
      momentum: 72,
      category: "Finance",
    },
    {
      market_id: "12",
      title: "Will Apple announce VR headset v2 in 2025?",
      outcome: "YES",
      last_price: 0.72,
      price_delta: 2.1,
      volume_24h: 56000,
      trades_24h: 198,
      buyers_24h: 115,
      sellers_24h: 75,
      unique_addresses_24h: 178,
      whale_buys_24h: 9,
      whale_sells_24h: 5,
      whale_volume_buy_24h: 24000,
      whale_volume_sell_24h: 14000,
      whale_pressure: 10000,
      whale_buy_sell_ratio: 1.80,
      buy_sell_ratio: 1.53,
      volatility: 0.13,
      spread_bps: 20,
      smart_buyers_24h: 22,
      smart_sellers_24h: 14,
      smart_volume_buy_24h: 28000,
      smart_volume_sell_24h: 16000,
      smart_buy_sell_ratio: 1.75,
      smart_pressure: 12000,
      sii: 56,
      momentum: 74,
      category: "Technology",
    },
    {
      market_id: "13",
      title: "Will Fed cut interest rates 3+ times in 2025?",
      outcome: "NO",
      last_price: 0.34,
      price_delta: -4.5,
      volume_24h: 142000,
      trades_24h: 445,
      buyers_24h: 135,
      sellers_24h: 265,
      unique_addresses_24h: 372,
      whale_buys_24h: 10,
      whale_sells_24h: 22,
      whale_volume_buy_24h: 38000,
      whale_volume_sell_24h: 72000,
      whale_pressure: -34000,
      whale_buy_sell_ratio: 0.45,
      buy_sell_ratio: 0.51,
      volatility: 0.17,
      spread_bps: 29,
      smart_buyers_24h: 24,
      smart_sellers_24h: 48,
      smart_volume_buy_24h: 42000,
      smart_volume_sell_24h: 78000,
      smart_buy_sell_ratio: 0.50,
      smart_pressure: -36000,
      sii: -52,
      momentum: 34,
      category: "Finance",
    },
    {
      market_id: "14",
      title: "Will Barbie 2 be released in 2025?",
      outcome: "YES",
      last_price: 0.48,
      price_delta: 0.8,
      volume_24h: 28000,
      trades_24h: 125,
      buyers_24h: 68,
      sellers_24h: 52,
      unique_addresses_24h: 112,
      whale_buys_24h: 4,
      whale_sells_24h: 3,
      whale_volume_buy_24h: 9500,
      whale_volume_sell_24h: 7200,
      whale_pressure: 2300,
      whale_buy_sell_ratio: 1.31,
      buy_sell_ratio: 1.31,
      volatility: 0.25,
      spread_bps: 38,
      smart_buyers_24h: 14,
      smart_sellers_24h: 10,
      smart_volume_buy_24h: 11000,
      smart_volume_sell_24h: 8200,
      smart_buy_sell_ratio: 1.40,
      smart_pressure: 2800,
      sii: 18,
      momentum: 55,
      category: "Pop Culture",
    },
    {
      market_id: "15",
      title: "Will Yankees win World Series 2025?",
      outcome: "YES",
      last_price: 0.22,
      price_delta: -1.5,
      volume_24h: 38000,
      trades_24h: 185,
      buyers_24h: 72,
      sellers_24h: 98,
      unique_addresses_24h: 158,
      whale_buys_24h: 5,
      whale_sells_24h: 8,
      whale_volume_buy_24h: 12000,
      whale_volume_sell_24h: 18000,
      whale_pressure: -6000,
      whale_buy_sell_ratio: 0.63,
      buy_sell_ratio: 0.73,
      volatility: 0.19,
      spread_bps: 35,
      smart_buyers_24h: 12,
      smart_sellers_24h: 18,
      smart_volume_buy_24h: 14000,
      smart_volume_sell_24h: 20000,
      smart_buy_sell_ratio: 0.67,
      smart_pressure: -6000,
      sii: -15,
      momentum: 46,
      category: "Sports",
    },
  ];

  // Helper function to get ratio color class
  const getRatioColorClass = (ratio: number): string => {
    if (ratio > 1.5) return 'bg-green-500/20 text-green-700 dark:text-green-400 font-semibold';
    if (ratio > 1.1) return 'bg-green-500/10 text-green-600 dark:text-green-500';
    if (ratio >= 0.9) return 'bg-muted text-muted-foreground';
    if (ratio >= 0.5) return 'bg-red-500/10 text-red-600 dark:text-red-500';
    return 'bg-red-500/20 text-red-700 dark:text-red-400 font-semibold';
  };

  // Helper function to get pressure color class
  const getPressureColorClass = (pressure: number): string => {
    const absValue = Math.abs(pressure);
    if (pressure > 0) {
      // Positive pressure - green gradient
      if (absValue > 40000) return 'bg-green-500/30 text-green-800 dark:text-green-300 font-semibold';
      if (absValue > 20000) return 'bg-green-500/20 text-green-700 dark:text-green-400';
      if (absValue > 5000) return 'bg-green-500/10 text-green-600 dark:text-green-500';
      return 'bg-green-500/5 text-green-600 dark:text-green-500';
    } else if (pressure < 0) {
      // Negative pressure - red gradient
      if (absValue > 40000) return 'bg-red-500/30 text-red-800 dark:text-red-300 font-semibold';
      if (absValue > 20000) return 'bg-red-500/20 text-red-700 dark:text-red-400';
      if (absValue > 5000) return 'bg-red-500/10 text-red-600 dark:text-red-500';
      return 'bg-red-500/5 text-red-600 dark:text-red-500';
    }
    return 'bg-muted text-muted-foreground';
  };

  // Helper function to get volume gradient class
  const getVolumeColorClass = (volume: number, maxVolume: number): string => {
    const ratio = volume / maxVolume;
    if (ratio > 0.8) return 'bg-green-500/30 text-foreground font-semibold';
    if (ratio > 0.6) return 'bg-green-500/20 text-foreground';
    if (ratio > 0.4) return 'bg-green-500/10 text-foreground';
    if (ratio > 0.2) return 'bg-green-500/5 text-foreground';
    return 'text-foreground';
  };

  // Generate mock sparkline data based on momentum and price delta
  const generateSparklineData = (momentum: number, priceDelta: number): number[] => {
    const points = 10;
    const data: number[] = [];
    const trend = priceDelta > 0 ? 1 : -1;
    const volatility = Math.random() * 0.3 + 0.1;

    for (let i = 0; i < points; i++) {
      const progress = i / points;
      const trendValue = 50 + (trend * progress * 20);
      const noise = (Math.random() - 0.5) * volatility * 50;
      data.push(Math.max(0, Math.min(100, trendValue + noise)));
    }

    return data;
  };

  // Mini sparkline component
  const MiniSparkline = ({ data, trend }: { data: number[]; trend: 'up' | 'down' }) => {
    const width = 70;
    const height = 30;
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;

    const points = data.map((value, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    }).join(' ');

    const lineColor = trend === 'up' ? 'rgb(34, 197, 94)' : 'rgb(239, 68, 68)';

    return (
      <svg width={width} height={height} className="inline-block">
        <polyline
          points={points}
          fill="none"
          stroke={lineColor}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  };

  // Count active filters
  const getActiveFilterCount = (): number => {
    let count = 0;
    if (filters.categories.length > 0) count++;
    if (filters.outcomes.length > 0) count++;
    if (filters.priceRange[0] !== 0.01 || filters.priceRange[1] !== 0.99) count++;
    if (filters.volumeRange[0] !== 0 || filters.volumeRange[1] !== 250000) count++;
    if (filters.tradesRange[0] !== 0 || filters.tradesRange[1] !== 1000) count++;
    if (filters.buyersRange[0] !== 0 || filters.buyersRange[1] !== 500) count++;
    if (filters.sellersRange[0] !== 0 || filters.sellersRange[1] !== 500) count++;
    if (filters.siiRange[0] !== -100 || filters.siiRange[1] !== 100) count++;
    if (filters.whalePressureRange[0] !== -100000 || filters.whalePressureRange[1] !== 100000) count++;
    if (filters.smartPressureRange[0] !== -100000 || filters.smartPressureRange[1] !== 100000) count++;
    return count;
  };

  // Clear all filters
  const clearAllFilters = () => {
    setFilters({
      categories: [],
      outcomes: [],
      priceRange: [0.01, 0.99],
      volumeRange: [0, 250000],
      tradesRange: [0, 1000],
      buyersRange: [0, 500],
      sellersRange: [0, 500],
      siiRange: [-100, 100],
      whalePressureRange: [-100000, 100000],
      smartPressureRange: [-100000, 100000],
    });
  };

  // Filtering
  const filteredMarkets = useMemo(() => {
    return markets.filter((market) => {
      // Search filter
      const matchesSearch = market.title
        .toLowerCase()
        .includes(searchQuery.toLowerCase());

      // Category filter
      const matchesCategory = filters.categories.length === 0 ||
        filters.categories.includes(market.category);

      // Outcome filter
      const matchesOutcome = filters.outcomes.length === 0 ||
        filters.outcomes.includes(market.outcome);

      // Price range filter
      const matchesPrice = market.last_price >= filters.priceRange[0] &&
        market.last_price <= filters.priceRange[1];

      // Volume range filter
      const matchesVolume = market.volume_24h >= filters.volumeRange[0] &&
        market.volume_24h <= filters.volumeRange[1];

      // Trades range filter
      const matchesTrades = market.trades_24h >= filters.tradesRange[0] &&
        market.trades_24h <= filters.tradesRange[1];

      // Buyers range filter
      const matchesBuyers = market.buyers_24h >= filters.buyersRange[0] &&
        market.buyers_24h <= filters.buyersRange[1];

      // Sellers range filter
      const matchesSellers = market.sellers_24h >= filters.sellersRange[0] &&
        market.sellers_24h <= filters.sellersRange[1];

      // SII range filter
      const matchesSII = market.sii >= filters.siiRange[0] &&
        market.sii <= filters.siiRange[1];

      // Whale pressure range filter
      const matchesWhalePressure = market.whale_pressure >= filters.whalePressureRange[0] &&
        market.whale_pressure <= filters.whalePressureRange[1];

      // Smart pressure range filter
      const matchesSmartPressure = market.smart_pressure >= filters.smartPressureRange[0] &&
        market.smart_pressure <= filters.smartPressureRange[1];

      return matchesSearch && matchesCategory && matchesOutcome && matchesPrice &&
        matchesVolume && matchesTrades && matchesBuyers && matchesSellers &&
        matchesSII && matchesWhalePressure && matchesSmartPressure;
    });
  }, [markets, searchQuery, filters]);

  // Sorting
  const sortedMarkets = useMemo(() => {
    const sorted = [...filteredMarkets];
    sorted.sort((a, b) => {
      const aValue = a[sortField];
      const bValue = b[sortField];

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortDirection === "asc" ? aValue - bValue : bValue - aValue;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === "asc"
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      return 0;
    });
    return sorted;
  }, [filteredMarkets, sortField, sortDirection]);

  const handleSort = (field: keyof MarketScreenerRow) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const getSIIColor = (sii: number) => {
    if (sii > 50) return "text-green-600 dark:text-green-400 font-bold";
    if (sii > 0) return "text-green-500 dark:text-green-500";
    if (sii > -50) return "text-red-500 dark:text-red-500";
    return "text-red-600 dark:text-red-400 font-bold";
  };

  const getMomentumColor = (momentum: number) => {
    if (momentum > 70) return "text-green-600 dark:text-green-400";
    if (momentum > 40) return "text-muted-foreground";
    return "text-red-600 dark:text-red-400";
  };

  // Calculate max volume for gradient
  const maxVolume = Math.max(...markets.map(m => m.volume_24h));

  // Handle cell click
  const handleCellClick = (marketId: string, column: string) => {
    setSelectedCell({ marketId, column });
  };

  // Check if cell is selected
  const isCellSelected = (marketId: string, column: string) => {
    return selectedCell?.marketId === marketId && selectedCell?.column === column;
  };

  return (
    <div className="flex flex-col h-full space-y-4 p-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Market Screener</h1>
        <p className="text-muted-foreground">
          Find high-conviction prediction markets using SII and momentum signals
        </p>
      </div>

      {/* Search and Filter Controls */}
      <div className="flex gap-4 flex-wrap items-center">
        <Input
          placeholder="Search markets..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-sm"
        />

        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">Time Window:</Label>
          <div className="flex gap-1 border rounded-md p-1">
            {(['24h', '12h', '6h', '1h', '10m'] as TimeWindow[]).map((window) => (
              <button
                key={window}
                onClick={() => setTimeWindow(window)}
                className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                  timeWindow === window
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted text-muted-foreground'
                }`}
              >
                {window}
              </button>
            ))}
          </div>
        </div>

        <Button
          variant={showFilters ? "default" : "outline"}
          onClick={() => setShowFilters(!showFilters)}
          className="gap-2"
        >
          <Filter className="h-4 w-4" />
          Filters
          {getActiveFilterCount() > 0 && (
            <Badge variant="secondary" className="ml-1 px-1.5 py-0.5 text-xs">
              {getActiveFilterCount()}
            </Badge>
          )}
          {showFilters ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>

        {getActiveFilterCount() > 0 && (
          <Button variant="ghost" onClick={clearAllFilters} className="gap-2">
            <X className="h-4 w-4" />
            Clear All
          </Button>
        )}
      </div>

      {/* Advanced Filter Panel */}
      {showFilters && (
        <div className="border rounded-lg p-6 space-y-6 bg-muted/50">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Category Filter */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold">Categories</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    {filters.categories.length === 0
                      ? 'All Categories'
                      : `${filters.categories.length} selected`}
                    <ChevronDown className="h-4 w-4 ml-2" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64">
                  <div className="space-y-2">
                    {availableCategories.map((category) => (
                      <div key={category} className="flex items-center space-x-2">
                        <Checkbox
                          id={`cat-${category}`}
                          checked={filters.categories.includes(category)}
                          onCheckedChange={(checked) => {
                            setFilters(prev => ({
                              ...prev,
                              categories: checked
                                ? [...prev.categories, category]
                                : prev.categories.filter(c => c !== category)
                            }));
                          }}
                        />
                        <Label
                          htmlFor={`cat-${category}`}
                          className="text-sm font-normal cursor-pointer"
                        >
                          {category}
                        </Label>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {/* Outcome Filter */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold">Market Outcome</Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="outcome-yes"
                    checked={filters.outcomes.includes('YES')}
                    onCheckedChange={(checked) => {
                      setFilters(prev => ({
                        ...prev,
                        outcomes: checked
                          ? [...prev.outcomes, 'YES']
                          : prev.outcomes.filter(o => o !== 'YES')
                      }));
                    }}
                  />
                  <Label htmlFor="outcome-yes" className="text-sm font-normal cursor-pointer">
                    YES
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="outcome-no"
                    checked={filters.outcomes.includes('NO')}
                    onCheckedChange={(checked) => {
                      setFilters(prev => ({
                        ...prev,
                        outcomes: checked
                          ? [...prev.outcomes, 'NO']
                          : prev.outcomes.filter(o => o !== 'NO')
                      }));
                    }}
                  />
                  <Label htmlFor="outcome-no" className="text-sm font-normal cursor-pointer">
                    NO
                  </Label>
                </div>
              </div>
            </div>

            {/* Price Range Filter */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold">
                Last Price: ${filters.priceRange[0].toFixed(2)} - ${filters.priceRange[1].toFixed(2)}
              </Label>
              <Slider
                min={0.01}
                max={0.99}
                step={0.01}
                value={filters.priceRange}
                onValueChange={(value) => setFilters(prev => ({ ...prev, priceRange: value as [number, number] }))}
                className="w-full"
              />
            </div>

            {/* Volume Range Filter */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold">
                Volume 24h: ${(filters.volumeRange[0] / 1000).toFixed(0)}k - ${(filters.volumeRange[1] / 1000).toFixed(0)}k
              </Label>
              <Slider
                min={0}
                max={250000}
                step={1000}
                value={filters.volumeRange}
                onValueChange={(value) => setFilters(prev => ({ ...prev, volumeRange: value as [number, number] }))}
                className="w-full"
              />
            </div>

            {/* Trades Range Filter */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold">
                Trades 24h: {filters.tradesRange[0]} - {filters.tradesRange[1]}
              </Label>
              <Slider
                min={0}
                max={1000}
                step={10}
                value={filters.tradesRange}
                onValueChange={(value) => setFilters(prev => ({ ...prev, tradesRange: value as [number, number] }))}
                className="w-full"
              />
            </div>

            {/* Buyers Range Filter */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold">
                Buyers 24h: {filters.buyersRange[0]} - {filters.buyersRange[1]}
              </Label>
              <Slider
                min={0}
                max={500}
                step={5}
                value={filters.buyersRange}
                onValueChange={(value) => setFilters(prev => ({ ...prev, buyersRange: value as [number, number] }))}
                className="w-full"
              />
            </div>

            {/* Sellers Range Filter */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold">
                Sellers 24h: {filters.sellersRange[0]} - {filters.sellersRange[1]}
              </Label>
              <Slider
                min={0}
                max={500}
                step={5}
                value={filters.sellersRange}
                onValueChange={(value) => setFilters(prev => ({ ...prev, sellersRange: value as [number, number] }))}
                className="w-full"
              />
            </div>

            {/* SII Range Filter */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold">
                SII Score: {filters.siiRange[0]} to {filters.siiRange[1]}
              </Label>
              <Slider
                min={-100}
                max={100}
                step={5}
                value={filters.siiRange}
                onValueChange={(value) => setFilters(prev => ({ ...prev, siiRange: value as [number, number] }))}
                className="w-full"
              />
            </div>

            {/* Whale Pressure Range Filter */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold">
                Whale Pressure: ${(filters.whalePressureRange[0] / 1000).toFixed(0)}k - ${(filters.whalePressureRange[1] / 1000).toFixed(0)}k
              </Label>
              <Slider
                min={-100000}
                max={100000}
                step={1000}
                value={filters.whalePressureRange}
                onValueChange={(value) => setFilters(prev => ({ ...prev, whalePressureRange: value as [number, number] }))}
                className="w-full"
              />
            </div>

            {/* Smart Pressure Range Filter */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold">
                Smart Pressure: ${(filters.smartPressureRange[0] / 1000).toFixed(0)}k - ${(filters.smartPressureRange[1] / 1000).toFixed(0)}k
              </Label>
              <Slider
                min={-100000}
                max={100000}
                step={1000}
                value={filters.smartPressureRange}
                onValueChange={(value) => setFilters(prev => ({ ...prev, smartPressureRange: value as [number, number] }))}
                className="w-full"
              />
            </div>
          </div>
        </div>
      )}

      {/* Table - CRITICAL FIX: Restructured for sticky header and row borders */}
      <div className="border rounded-lg">
        <div
          ref={scrollContainerRef}
          className="overflow-auto max-h-[600px]"
          style={{
            overscrollBehavior: 'none',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          <table className="w-full whitespace-nowrap caption-bottom text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead className="sticky top-0 bg-background z-50" style={{ boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <tr className="border-b">
                <th
                  className="w-[300px] sticky left-0 bg-background z-50 h-10 px-2 text-left align-middle font-medium text-muted-foreground"
                  style={{ borderRight: '1px solid hsl(var(--border))' }}
                >
                  Market
                </th>
                <th
                  className="h-10 px-2 text-left align-middle font-medium text-muted-foreground"
                  style={{ borderRight: '1px solid hsl(var(--border))' }}
                >
                  Outcome
                </th>
                <th
                  className="cursor-pointer h-10 px-2 text-right align-middle font-medium text-muted-foreground"
                  onClick={() => handleSort("sii")}
                  style={{ borderRight: '1px solid hsl(var(--border))' }}
                >
                  <div className="flex items-center justify-end gap-1">
                    SII
                    <ArrowUpDown className="h-4 w-4" />
                  </div>
                </th>
                <th
                  className="h-10 px-2 text-right align-middle font-medium text-muted-foreground"
                  style={{ borderRight: '1px solid hsl(var(--border))' }}
                >
                  Momentum
                </th>
                <th
                  className="h-10 px-2 text-right align-middle font-medium text-muted-foreground"
                  style={{ borderRight: '1px solid hsl(var(--border))' }}
                >
                  Price
                </th>
                <th
                  className="cursor-pointer h-10 px-2 text-right align-middle font-medium text-muted-foreground"
                  onClick={() => handleSort("price_delta")}
                  style={{ borderRight: '1px solid hsl(var(--border))' }}
                >
                  <div className="flex items-center justify-end gap-1">
                    Price Δ
                    <ArrowUpDown className="h-4 w-4" />
                  </div>
                </th>
                <th
                  className="cursor-pointer h-10 px-2 text-right align-middle font-medium text-muted-foreground"
                  onClick={() => handleSort("volume_24h")}
                  style={{ borderRight: '1px solid hsl(var(--border))' }}
                >
                  <div className="flex items-center justify-end gap-1">
                    Volume
                    <ArrowUpDown className="h-4 w-4" />
                  </div>
                </th>
                <th
                  className="h-10 px-2 text-right align-middle font-medium text-muted-foreground"
                  style={{ borderRight: '1px solid hsl(var(--border))' }}
                >
                  # Trades
                </th>
                <th
                  className="h-10 px-2 text-right align-middle font-medium text-muted-foreground"
                  style={{ borderRight: '1px solid hsl(var(--border))' }}
                >
                  # Buyers
                </th>
                <th
                  className="h-10 px-2 text-right align-middle font-medium text-muted-foreground"
                  style={{ borderRight: '1px solid hsl(var(--border))' }}
                >
                  # Sellers
                </th>
                <th
                  className="h-10 px-2 text-right align-middle font-medium text-muted-foreground"
                  style={{ borderRight: '1px solid hsl(var(--border))' }}
                >
                  Buy/Sell
                </th>
                <th
                  className="h-10 px-2 text-right align-middle font-medium text-muted-foreground"
                  style={{ borderRight: '1px solid hsl(var(--border))' }}
                >
                  Whale B/S
                </th>
                <th
                  className="cursor-pointer h-10 px-2 text-right align-middle font-medium text-muted-foreground"
                  onClick={() => handleSort("whale_pressure")}
                  style={{ borderRight: '1px solid hsl(var(--border))' }}
                >
                  <div className="flex items-center justify-end gap-1">
                    Whale Pressure
                    <ArrowUpDown className="h-4 w-4" />
                  </div>
                </th>
                <th
                  className="h-10 px-2 text-right align-middle font-medium text-muted-foreground"
                  style={{ borderRight: '1px solid hsl(var(--border))' }}
                >
                  Smart B/S
                </th>
                <th
                  className="cursor-pointer h-10 px-2 text-right align-middle font-medium text-muted-foreground"
                  onClick={() => handleSort("smart_pressure")}
                  style={{ borderRight: '1px solid hsl(var(--border))' }}
                >
                  <div className="flex items-center justify-end gap-1">
                    Smart Pressure
                    <ArrowUpDown className="h-4 w-4" />
                  </div>
                </th>
                <th
                  className="h-10 px-2 text-left align-middle font-medium text-muted-foreground"
                  style={{ borderRight: '1px solid hsl(var(--border))' }}
                >
                  Category
                </th>
                <th className="h-10 px-2 text-left align-middle font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedMarkets.map((market) => {
                const sparklineData = generateSparklineData(market.momentum, market.price_delta);
                const sparklineTrend = market.price_delta > 0 ? 'up' : 'down';

                return (
                  <tr
                    key={market.market_id}
                    className="transition-colors hover:bg-muted/50"
                    style={{ borderTop: '1px solid hsl(var(--border))' }}
                  >
                    <td
                      className="font-medium sticky left-0 bg-background z-10 p-2 align-middle"
                      style={{ borderRight: '1px solid hsl(var(--border))' }}
                    >
                      <Link
                        href={`/analysis/market/${market.market_id}`}
                        className="text-foreground hover:text-primary hover:underline transition-colors"
                      >
                        {market.title}
                      </Link>
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'outcome')}
                      className={`p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'outcome') ? 'ring-2 ring-primary ring-inset' : ''}`}
                      style={{ borderRight: '1px solid hsl(var(--border))' }}
                    >
                      <span
                        className={
                          market.outcome === "YES" ? "text-green-600 dark:text-green-400 font-medium" : "text-red-600 dark:text-red-400 font-medium"
                        }
                      >
                        {market.outcome}
                      </span>
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'sii')}
                      className={`text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'sii') ? 'ring-2 ring-primary ring-inset' : ''} ${getSIIColor(market.sii)}`}
                      style={{ borderRight: '1px solid hsl(var(--border))' }}
                    >
                      {market.sii}
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'momentum')}
                      className={`text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'momentum') ? 'ring-2 ring-primary ring-inset' : ''}`}
                      style={{ borderRight: '1px solid hsl(var(--border))' }}
                    >
                      <div className="flex items-center justify-end gap-2">
                        <span className={getMomentumColor(market.momentum)}>
                          {market.momentum}
                        </span>
                        <MiniSparkline data={sparklineData} trend={sparklineTrend} />
                      </div>
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'price')}
                      className={`text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'price') ? 'ring-2 ring-primary ring-inset' : ''}`}
                      style={{ borderRight: '1px solid hsl(var(--border))' }}
                    >
                      {(market.last_price * 100).toFixed(1)}¢
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'price_delta')}
                      className={`text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'price_delta') ? 'ring-2 ring-primary ring-inset' : ''} ${market.price_delta > 0 ? "text-green-600 dark:text-green-400 font-semibold" : market.price_delta < 0 ? "text-red-600 dark:text-red-400 font-semibold" : ""}`}
                      style={{ borderRight: '1px solid hsl(var(--border))' }}
                    >
                      {market.price_delta > 0 ? "↑ +" : market.price_delta < 0 ? "↓ " : ""}{Math.abs(market.price_delta).toFixed(1)}%
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'volume')}
                      className={`text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'volume') ? 'ring-2 ring-primary ring-inset' : ''} ${getVolumeColorClass(market.volume_24h, maxVolume)}`}
                      style={{ borderRight: '1px solid hsl(var(--border))' }}
                    >
                      ${(market.volume_24h / 1000).toFixed(0)}k
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'trades')}
                      className={`text-muted-foreground text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'trades') ? 'ring-2 ring-primary ring-inset' : ''}`}
                      style={{ borderRight: '1px solid hsl(var(--border))' }}
                    >
                      {market.trades_24h}
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'buyers')}
                      className={`text-muted-foreground text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'buyers') ? 'ring-2 ring-primary ring-inset' : ''}`}
                      style={{ borderRight: '1px solid hsl(var(--border))' }}
                    >
                      {market.buyers_24h}
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'sellers')}
                      className={`text-muted-foreground text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'sellers') ? 'ring-2 ring-primary ring-inset' : ''}`}
                      style={{ borderRight: '1px solid hsl(var(--border))' }}
                    >
                      {market.sellers_24h}
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'buy_sell_ratio')}
                      className={`text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'buy_sell_ratio') ? 'ring-2 ring-primary ring-inset' : ''} ${getRatioColorClass(market.buy_sell_ratio)}`}
                      style={{ borderRight: '1px solid hsl(var(--border))' }}
                    >
                      {market.buy_sell_ratio.toFixed(2)}
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'whale_ratio')}
                      className={`text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'whale_ratio') ? 'ring-2 ring-primary ring-inset' : ''} ${getRatioColorClass(market.whale_buy_sell_ratio)}`}
                      style={{ borderRight: '1px solid hsl(var(--border))' }}
                    >
                      {market.whale_buy_sell_ratio.toFixed(2)}
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'whale_pressure')}
                      className={`text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'whale_pressure') ? 'ring-2 ring-primary ring-inset' : ''} ${getPressureColorClass(market.whale_pressure)}`}
                      style={{ borderRight: '1px solid hsl(var(--border))' }}
                    >
                      {market.whale_pressure > 0 ? '+' : ''}{(market.whale_pressure / 1000).toFixed(0)}k
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'smart_ratio')}
                      className={`text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'smart_ratio') ? 'ring-2 ring-primary ring-inset' : ''} ${getRatioColorClass(market.smart_buy_sell_ratio)}`}
                      style={{ borderRight: '1px solid hsl(var(--border))' }}
                    >
                      {market.smart_buy_sell_ratio.toFixed(2)}
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'smart_pressure')}
                      className={`text-right p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'smart_pressure') ? 'ring-2 ring-primary ring-inset' : ''} ${getPressureColorClass(market.smart_pressure)}`}
                      style={{ borderRight: '1px solid hsl(var(--border))' }}
                    >
                      {market.smart_pressure > 0 ? '+' : ''}{(market.smart_pressure / 1000).toFixed(0)}k
                    </td>
                    <td
                      onClick={() => handleCellClick(market.market_id, 'category')}
                      className={`bg-secondary/50 text-secondary-foreground p-2 align-middle cursor-pointer ${isCellSelected(market.market_id, 'category') ? 'ring-2 ring-primary ring-inset' : ''}`}
                      style={{ borderRight: '1px solid hsl(var(--border))' }}
                    >
                      {market.category}
                    </td>
                    <td className="p-2 align-middle">
                      <Button size="sm" variant="ghost">
                        <Star className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Results count */}
      <div className="text-sm text-muted-foreground">
        Showing {sortedMarkets.length} of {markets.length} markets
      </div>
    </div>
  );
}
