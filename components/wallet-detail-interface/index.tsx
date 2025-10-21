"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ReactECharts from "echarts-for-react";
import { ArrowLeft, Wallet, TrendingUp, TrendingDown, Trophy, Target, Calendar, BarChart3, Copy, Award, Zap, Medal, Star, Activity, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
// Tabs removed - now using single scrollable page
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TradingBubbleChart } from "./components/trading-bubble-chart";
import { TradingCalendarHeatmap } from "./components/trading-calendar-heatmap";
import type {
  WalletProfile,
  WalletTrade,
  WalletPosition,
  PnLHistoryPoint,
  WinRateHistoryPoint,
  MarketDistributionItem,
  WalletComparison,
  ActiveBet,
  FinishedBet,
  CategoryStats,
  EntryBucket,
} from "./types";

interface WalletDetailProps {
  walletAddress: string;
}

export function WalletDetail({ walletAddress }: WalletDetailProps) {
  const router = useRouter();

  // Mock wallet profile data
  const wallet: WalletProfile = {
    wallet_address: walletAddress,
    wallet_alias: "WhaleTrader42",
    wis: 85,
    contrarian_pct: 62, // 62% of entries below 0.5
    lottery_ticket_count: 3, // 3 lottery ticket positions
    is_senior: false, // < 1000 total positions
    bagholder_pct: 69.9, // 69.9% of positions below entry
    reverse_cramer_count: 3, // 3 reverse cramer positions
    whale_splash_count: 212, // 212 positions > $20k
    is_millionaire: true, // total invested >= $1M
    total_invested: 250000,
    realized_pnl: 45000,
    realized_pnl_pct: 18.0,
    unrealized_pnl: 12000,
    unrealized_pnl_pct: 4.8,
    total_pnl: 57000,
    total_pnl_pct: 22.8,
    total_trades: 156,
    winning_trades: 98,
    losing_trades: 58,
    win_rate: 0.628,
    avg_trade_size: 1602,
    largest_win: 8500,
    largest_loss: -3200,
    markets_traded: 42,
    active_positions: 8,
    first_trade_date: "2024-01-15T00:00:00Z",
    last_trade_date: "2025-10-20T14:32:00Z",
    days_active: 279,
    rank_by_pnl: 23,
    rank_by_wis: 45,
    rank_by_volume: 18,
    risk_metrics: {
      sharpe_ratio_30d: 1.85,
      sharpe_level: 'Good',
      traded_volume_30d_daily: Array.from({ length: 30 }, (_, i) => ({
        date: new Date(Date.now() - (30 - i) * 86400000).toISOString(),
        volume_usd: 2000 + Math.random() * 8000 + Math.sin(i / 5) * 3000,
      })),
      traded_volume_30d_total: 150000,
    },
    pnl_ranks: {
      d1: { period: '1D', rank: 45, pnl_usd: 850 },
      d7: { period: '7D', rank: 28, pnl_usd: 4200 },
      d30: { period: '30D', rank: 23, pnl_usd: 12800 },
      all: { period: 'All', rank: 23, pnl_usd: 57000 },
    },
  };

  // PnL history (90 days)
  const pnlHistory: PnLHistoryPoint[] = Array.from({ length: 90 }, (_, i) => {
    const realized = 10000 + (i / 90) * 35000 + Math.sin(i / 10) * 3000;
    const unrealized = 5000 + Math.sin(i / 5) * 7000;
    return {
      date: new Date(Date.now() - (90 - i) * 86400000).toISOString(),
      realized_pnl: realized,
      unrealized_pnl: unrealized,
      total_pnl: realized + unrealized,
      total_invested: 100000 + (i / 90) * 150000,
    };
  });

  // Win rate history
  const winRateHistory: WinRateHistoryPoint[] = Array.from({ length: 90 }, (_, i) => ({
    date: new Date(Date.now() - (90 - i) * 86400000).toISOString(),
    win_rate: 0.55 + Math.sin(i / 15) * 0.08 + (i / 90) * 0.05,
    total_trades: Math.floor((i / 90) * 156),
    winning_trades: Math.floor((i / 90) * 98),
  }));

  // Trading history
  const tradingHistory: WalletTrade[] = [
    {
      trade_id: "1",
      timestamp: "2025-10-20T14:32:00Z",
      market_id: "trump-2024",
      market_title: "Will Trump win 2024?",
      side: "YES",
      action: "BUY",
      shares: 50000,
      price: 0.63,
      amount_usd: 31500,
      market_outcome: "OPEN",
      pnl: null,
      pnl_pct: null,
    },
    {
      trade_id: "2",
      timestamp: "2025-10-19T11:20:00Z",
      market_id: "btc-100k",
      market_title: "Will BTC hit $100k in 2024?",
      side: "NO",
      action: "SELL",
      shares: 30000,
      price: 0.45,
      amount_usd: 13500,
      market_outcome: "NO",
      pnl: 4500,
      pnl_pct: 33.3,
    },
    {
      trade_id: "3",
      timestamp: "2025-10-18T09:15:00Z",
      market_id: "eth-5k",
      market_title: "Will ETH reach $5k?",
      side: "YES",
      action: "BUY",
      shares: 40000,
      price: 0.72,
      amount_usd: 28800,
      market_outcome: "OPEN",
      pnl: null,
      pnl_pct: null,
    },
  ];

  // Active positions
  const activeBets: ActiveBet[] = [
    {
      position_id: "1",
      market_id: "trump-2024",
      market_title: "Will Trump win 2024?",
      category: "Politics",
      side: "YES",
      shares: 150000,
      avg_entry_price: 0.61,
      current_price: 0.63,
      invested: 91500,
      current_value: 94500,
      unrealized_pnl: 3000,
      unrealized_pnl_pct: 3.28,
      market_end_date: "2024-11-05T23:59:59Z",
    },
    {
      position_id: "2",
      market_id: "eth-5k",
      market_title: "Will ETH reach $5k?",
      category: "Crypto",
      side: "YES",
      shares: 80000,
      avg_entry_price: 0.70,
      current_price: 0.68,
      invested: 56000,
      current_value: 54400,
      unrealized_pnl: -1600,
      unrealized_pnl_pct: -2.86,
      market_end_date: "2024-12-31T23:59:59Z",
    },
    {
      position_id: "3",
      market_id: "ai-agi-2025",
      market_title: "Will AGI be achieved by 2025?",
      category: "Tech",
      side: "NO",
      shares: 120000,
      avg_entry_price: 0.35,
      current_price: 0.32,
      invested: 42000,
      current_value: 38400,
      unrealized_pnl: -3600,
      unrealized_pnl_pct: -8.57,
      market_end_date: "2025-12-31T23:59:59Z",
    },
  ];

  // Finished positions
  const finishedBets: FinishedBet[] = [
    // Crypto trades
    {
      position_id: "f1",
      market_id: "btc-100k",
      market_title: "Will BTC hit $100k in 2024?",
      category: "Crypto",
      side: "NO",
      shares: 30000,
      avg_entry_price: 0.30,
      exit_price: 1.0,
      invested: 9000,
      final_value: 30000,
      realized_pnl: 21000,
      realized_pnl_pct: 233.33,
      roi: 233.33,
      closed_date: "2025-10-15T18:30:00Z",
      market_outcome: "NO",
    },
    {
      position_id: "f6",
      market_id: "eth-merge",
      market_title: "Will ETH merge succeed without issues?",
      category: "Crypto",
      side: "YES",
      shares: 45000,
      avg_entry_price: 0.68,
      exit_price: 1.0,
      invested: 30600,
      final_value: 45000,
      realized_pnl: 14400,
      realized_pnl_pct: 47.06,
      roi: 47.06,
      closed_date: "2024-09-15T10:00:00Z",
      market_outcome: "YES",
    },
    {
      position_id: "f7",
      market_id: "solana-outage",
      market_title: "Will Solana have network outage in Q3?",
      category: "Crypto",
      side: "YES",
      shares: 28000,
      avg_entry_price: 0.42,
      exit_price: 1.0,
      invested: 11760,
      final_value: 28000,
      realized_pnl: 16240,
      realized_pnl_pct: 138.10,
      roi: 138.10,
      closed_date: "2024-09-30T23:59:00Z",
      market_outcome: "YES",
    },
    {
      position_id: "f8",
      market_id: "doge-dollar",
      market_title: "Will DOGE reach $1 in 2024?",
      category: "Crypto",
      side: "NO",
      shares: 35000,
      avg_entry_price: 0.15,
      exit_price: 1.0,
      invested: 5250,
      final_value: 35000,
      realized_pnl: 29750,
      realized_pnl_pct: 566.67,
      roi: 566.67,
      closed_date: "2024-12-31T23:59:00Z",
      market_outcome: "NO",
    },
    {
      position_id: "f9",
      market_id: "cardano-upgrade",
      market_title: "Will Cardano ship Hydra in 2024?",
      category: "Crypto",
      side: "NO",
      shares: 22000,
      avg_entry_price: 0.55,
      exit_price: 1.0,
      invested: 12100,
      final_value: 22000,
      realized_pnl: 9900,
      realized_pnl_pct: 81.82,
      roi: 81.82,
      closed_date: "2024-11-20T16:00:00Z",
      market_outcome: "NO",
    },
    // Finance trades
    {
      position_id: "f2",
      market_id: "fed-rate-cut",
      market_title: "Will Fed cut rates in Sept 2024?",
      category: "Finance",
      side: "YES",
      shares: 50000,
      avg_entry_price: 0.72,
      exit_price: 1.0,
      invested: 36000,
      final_value: 50000,
      realized_pnl: 14000,
      realized_pnl_pct: 38.89,
      roi: 38.89,
      closed_date: "2024-09-18T14:00:00Z",
      market_outcome: "YES",
    },
    {
      position_id: "f10",
      market_id: "recession-2024",
      market_title: "Will US enter recession in 2024?",
      category: "Finance",
      side: "NO",
      shares: 38000,
      avg_entry_price: 0.48,
      exit_price: 1.0,
      invested: 18240,
      final_value: 38000,
      realized_pnl: 19760,
      realized_pnl_pct: 108.33,
      roi: 108.33,
      closed_date: "2024-12-15T18:00:00Z",
      market_outcome: "NO",
    },
    {
      position_id: "f11",
      market_id: "sp500-5000",
      market_title: "Will S&P 500 hit 5000 in 2024?",
      category: "Finance",
      side: "YES",
      shares: 42000,
      avg_entry_price: 0.61,
      exit_price: 1.0,
      invested: 25620,
      final_value: 42000,
      realized_pnl: 16380,
      realized_pnl_pct: 63.93,
      roi: 63.93,
      closed_date: "2024-03-28T20:00:00Z",
      market_outcome: "YES",
    },
    {
      position_id: "f12",
      market_id: "gold-2500",
      market_title: "Will gold reach $2500/oz in 2024?",
      category: "Finance",
      side: "YES",
      shares: 33000,
      avg_entry_price: 0.58,
      exit_price: 0.0,
      invested: 19140,
      final_value: 0,
      realized_pnl: -19140,
      realized_pnl_pct: -100.0,
      roi: -100.0,
      closed_date: "2024-08-10T17:30:00Z",
      market_outcome: "NO",
    },
    // Pop Culture trades
    {
      position_id: "f3",
      market_id: "taylor-swift-grammys",
      market_title: "Will Taylor Swift win Album of the Year?",
      category: "Pop Culture",
      side: "YES",
      shares: 25000,
      avg_entry_price: 0.65,
      exit_price: 0.0,
      invested: 16250,
      final_value: 0,
      realized_pnl: -16250,
      realized_pnl_pct: -100.0,
      roi: -100.0,
      closed_date: "2025-02-02T22:00:00Z",
      market_outcome: "NO",
    },
    {
      position_id: "f13",
      market_id: "barbie-billion",
      market_title: "Will Barbie movie gross over $1B?",
      category: "Pop Culture",
      side: "YES",
      shares: 48000,
      avg_entry_price: 0.55,
      exit_price: 1.0,
      invested: 26400,
      final_value: 48000,
      realized_pnl: 21600,
      realized_pnl_pct: 81.82,
      roi: 81.82,
      closed_date: "2023-08-31T23:59:00Z",
      market_outcome: "YES",
    },
    {
      position_id: "f14",
      market_id: "beyonce-tour-record",
      market_title: "Will Beyoncé tour break revenue records?",
      category: "Pop Culture",
      side: "YES",
      shares: 41000,
      avg_entry_price: 0.72,
      exit_price: 1.0,
      invested: 29520,
      final_value: 41000,
      realized_pnl: 11480,
      realized_pnl_pct: 38.89,
      roi: 38.89,
      closed_date: "2023-10-15T20:00:00Z",
      market_outcome: "YES",
    },
    {
      position_id: "f15",
      market_id: "oscars-slap",
      market_title: "Will Will Smith attend 2024 Oscars?",
      category: "Pop Culture",
      side: "NO",
      shares: 29000,
      avg_entry_price: 0.68,
      exit_price: 1.0,
      invested: 19720,
      final_value: 29000,
      realized_pnl: 9280,
      realized_pnl_pct: 47.06,
      roi: 47.06,
      closed_date: "2024-03-10T22:00:00Z",
      market_outcome: "NO",
    },
    // Tech trades
    {
      position_id: "f4",
      market_id: "apple-vision-sales",
      market_title: "Will Apple sell 1M Vision Pros in Q1?",
      category: "Tech",
      side: "NO",
      shares: 40000,
      avg_entry_price: 0.58,
      exit_price: 1.0,
      invested: 23200,
      final_value: 40000,
      realized_pnl: 16800,
      realized_pnl_pct: 72.41,
      roi: 72.41,
      closed_date: "2024-04-01T00:00:00Z",
      market_outcome: "NO",
    },
    {
      position_id: "f16",
      market_id: "openai-gpt5",
      market_title: "Will OpenAI release GPT-5 in 2024?",
      category: "Tech",
      side: "NO",
      shares: 37000,
      avg_entry_price: 0.52,
      exit_price: 1.0,
      invested: 19240,
      final_value: 37000,
      realized_pnl: 17760,
      realized_pnl_pct: 92.31,
      roi: 92.31,
      closed_date: "2024-12-20T18:00:00Z",
      market_outcome: "NO",
    },
    {
      position_id: "f17",
      market_id: "meta-threads-users",
      market_title: "Will Threads reach 500M users in 2024?",
      category: "Tech",
      side: "NO",
      shares: 44000,
      avg_entry_price: 0.35,
      exit_price: 0.0,
      invested: 15400,
      final_value: 0,
      realized_pnl: -15400,
      realized_pnl_pct: -100.0,
      roi: -100.0,
      closed_date: "2024-12-31T23:59:00Z",
      market_outcome: "YES",
    },
    {
      position_id: "f18",
      market_id: "tesla-fsd",
      market_title: "Will Tesla achieve Full Self-Driving in 2024?",
      category: "Tech",
      side: "NO",
      shares: 31000,
      avg_entry_price: 0.28,
      exit_price: 1.0,
      invested: 8680,
      final_value: 31000,
      realized_pnl: 22320,
      realized_pnl_pct: 257.14,
      roi: 257.14,
      closed_date: "2024-11-30T23:59:00Z",
      market_outcome: "NO",
    },
    {
      position_id: "f19",
      market_id: "twitter-rebrand",
      market_title: "Will Twitter rebrand be successful?",
      category: "Tech",
      side: "NO",
      shares: 26000,
      avg_entry_price: 0.44,
      exit_price: 1.0,
      invested: 11440,
      final_value: 26000,
      realized_pnl: 14560,
      realized_pnl_pct: 127.27,
      roi: 127.27,
      closed_date: "2024-07-31T20:00:00Z",
      market_outcome: "NO",
    },
    // Sports trades
    {
      position_id: "f5",
      market_id: "nfl-chiefs-superbowl",
      market_title: "Will Chiefs win Super Bowl 2024?",
      category: "Sports",
      side: "YES",
      shares: 35000,
      avg_entry_price: 0.45,
      exit_price: 1.0,
      invested: 15750,
      final_value: 35000,
      realized_pnl: 19250,
      realized_pnl_pct: 122.22,
      roi: 122.22,
      closed_date: "2024-02-11T23:00:00Z",
      market_outcome: "YES",
    },
    {
      position_id: "f20",
      market_id: "argentina-world-cup",
      market_title: "Will Argentina win World Cup 2022?",
      category: "Sports",
      side: "YES",
      shares: 52000,
      avg_entry_price: 0.38,
      exit_price: 1.0,
      invested: 19760,
      final_value: 52000,
      realized_pnl: 32240,
      realized_pnl_pct: 163.16,
      roi: 163.16,
      closed_date: "2022-12-18T20:00:00Z",
      market_outcome: "YES",
    },
    {
      position_id: "f21",
      market_id: "lebron-retire",
      market_title: "Will LeBron retire in 2024?",
      category: "Sports",
      side: "NO",
      shares: 39000,
      avg_entry_price: 0.62,
      exit_price: 1.0,
      invested: 24180,
      final_value: 39000,
      realized_pnl: 14820,
      realized_pnl_pct: 61.29,
      roi: 61.29,
      closed_date: "2024-06-30T23:59:00Z",
      market_outcome: "NO",
    },
    {
      position_id: "f22",
      market_id: "ronaldo-transfer",
      market_title: "Will Ronaldo return to Europe in 2024?",
      category: "Sports",
      side: "NO",
      shares: 27000,
      avg_entry_price: 0.51,
      exit_price: 1.0,
      invested: 13770,
      final_value: 27000,
      realized_pnl: 13230,
      realized_pnl_pct: 96.08,
      roi: 96.08,
      closed_date: "2024-09-01T18:00:00Z",
      market_outcome: "NO",
    },
    {
      position_id: "f23",
      market_id: "olympics-usa-medals",
      market_title: "Will USA win most medals at 2024 Olympics?",
      category: "Sports",
      side: "YES",
      shares: 46000,
      avg_entry_price: 0.69,
      exit_price: 1.0,
      invested: 31740,
      final_value: 46000,
      realized_pnl: 14260,
      realized_pnl_pct: 44.93,
      roi: 44.93,
      closed_date: "2024-08-11T22:00:00Z",
      market_outcome: "YES",
    },
    // Politics trades
    {
      position_id: "f24",
      market_id: "biden-approval",
      market_title: "Will Biden approval hit 50% in 2024?",
      category: "Politics",
      side: "NO",
      shares: 43000,
      avg_entry_price: 0.42,
      exit_price: 1.0,
      invested: 18060,
      final_value: 43000,
      realized_pnl: 24940,
      realized_pnl_pct: 138.10,
      roi: 138.10,
      closed_date: "2024-12-31T23:59:00Z",
      market_outcome: "NO",
    },
    {
      position_id: "f25",
      market_id: "senate-control",
      market_title: "Will Republicans take Senate in 2024?",
      category: "Politics",
      side: "YES",
      shares: 38000,
      avg_entry_price: 0.64,
      exit_price: 1.0,
      invested: 24320,
      final_value: 38000,
      realized_pnl: 13680,
      realized_pnl_pct: 56.25,
      roi: 56.25,
      closed_date: "2024-11-06T02:00:00Z",
      market_outcome: "YES",
    },
    {
      position_id: "f26",
      market_id: "scotus-ruling",
      market_title: "Will SCOTUS overturn student loan forgiveness?",
      category: "Politics",
      side: "YES",
      shares: 49000,
      avg_entry_price: 0.71,
      exit_price: 1.0,
      invested: 34790,
      final_value: 49000,
      realized_pnl: 14210,
      realized_pnl_pct: 40.84,
      roi: 40.84,
      closed_date: "2023-06-30T16:00:00Z",
      market_outcome: "YES",
    },
    // Additional 2024-2025 trades for calendar visualization
    { position_id: "f27", market_id: "m27", market_title: "Will inflation cool in Q1 2024?", category: "Finance", side: "YES", shares: 25000, avg_entry_price: 0.55, exit_price: 1.0, invested: 13750, final_value: 25000, realized_pnl: 11250, realized_pnl_pct: 81.82, roi: 81.82, closed_date: "2024-01-15T14:00:00Z", market_outcome: "YES" },
    { position_id: "f28", market_id: "m28", market_title: "Will Lakers make playoffs?", category: "Sports", side: "NO", shares: 18000, avg_entry_price: 0.38, exit_price: 0.0, invested: 6840, final_value: 0, realized_pnl: -6840, realized_pnl_pct: -100.0, roi: -100.0, closed_date: "2024-01-22T18:30:00Z", market_outcome: "YES" },
    { position_id: "f29", market_id: "m29", market_title: "Will Microsoft acquire Activision?", category: "Tech", side: "YES", shares: 32000, avg_entry_price: 0.68, exit_price: 1.0, invested: 21760, final_value: 32000, realized_pnl: 10240, realized_pnl_pct: 47.06, roi: 47.06, closed_date: "2024-02-05T10:00:00Z", market_outcome: "YES" },
    { position_id: "f30", market_id: "m30", market_title: "Will new variant emerge?", category: "Pop Culture", side: "NO", shares: 22000, avg_entry_price: 0.45, exit_price: 1.0, invested: 9900, final_value: 22000, realized_pnl: 12100, realized_pnl_pct: 122.22, roi: 122.22, closed_date: "2024-02-18T16:45:00Z", market_outcome: "NO" },
    { position_id: "f31", market_id: "m31", market_title: "Will Bitcoin ETF get approved?", category: "Crypto", side: "YES", shares: 28000, avg_entry_price: 0.72, exit_price: 1.0, invested: 20160, final_value: 28000, realized_pnl: 7840, realized_pnl_pct: 38.89, roi: 38.89, closed_date: "2024-03-08T12:00:00Z", market_outcome: "YES" },
    { position_id: "f32", market_id: "m32", market_title: "Will Trump win primary?", category: "Politics", side: "YES", shares: 35000, avg_entry_price: 0.82, exit_price: 1.0, invested: 28700, final_value: 35000, realized_pnl: 6300, realized_pnl_pct: 21.95, roi: 21.95, closed_date: "2024-03-14T20:30:00Z", market_outcome: "YES" },
    { position_id: "f33", market_id: "m33", market_title: "Will Netflix raise prices?", category: "Tech", side: "YES", shares: 24000, avg_entry_price: 0.58, exit_price: 1.0, invested: 13920, final_value: 24000, realized_pnl: 10080, realized_pnl_pct: 72.41, roi: 72.41, closed_date: "2024-03-25T11:15:00Z", market_outcome: "YES" },
    { position_id: "f34", market_id: "m34", market_title: "Will UFC 300 break records?", category: "Sports", side: "YES", shares: 30000, avg_entry_price: 0.65, exit_price: 1.0, invested: 19500, final_value: 30000, realized_pnl: 10500, realized_pnl_pct: 53.85, roi: 53.85, closed_date: "2024-04-13T23:00:00Z", market_outcome: "YES" },
    { position_id: "f35", market_id: "m35", market_title: "Will Ethereum upgrade succeed?", category: "Crypto", side: "YES", shares: 26000, avg_entry_price: 0.48, exit_price: 1.0, invested: 12480, final_value: 26000, realized_pnl: 13520, realized_pnl_pct: 108.33, roi: 108.33, closed_date: "2024-04-20T15:30:00Z", market_outcome: "YES" },
    { position_id: "f36", market_id: "m36", market_title: "Will oil hit $100/barrel?", category: "Finance", side: "NO", shares: 20000, avg_entry_price: 0.35, exit_price: 1.0, invested: 7000, final_value: 20000, realized_pnl: 13000, realized_pnl_pct: 185.71, roi: 185.71, closed_date: "2024-05-02T13:00:00Z", market_outcome: "NO" },
    { position_id: "f37", market_id: "m37", market_title: "Will Deadpool 3 gross $1B?", category: "Pop Culture", side: "YES", shares: 33000, avg_entry_price: 0.62, exit_price: 0.0, invested: 20460, final_value: 0, realized_pnl: -20460, realized_pnl_pct: -100.0, roi: -100.0, closed_date: "2024-05-18T19:00:00Z", market_outcome: "NO" },
    { position_id: "f38", market_id: "m38", market_title: "Will Celtics win NBA title?", category: "Sports", side: "YES", shares: 29000, avg_entry_price: 0.58, exit_price: 1.0, invested: 16820, final_value: 29000, realized_pnl: 12180, realized_pnl_pct: 72.41, roi: 72.41, closed_date: "2024-06-17T22:30:00Z", market_outcome: "YES" },
    { position_id: "f39", market_id: "m39", market_title: "Will Biden drop out?", category: "Politics", side: "NO", shares: 21000, avg_entry_price: 0.25, exit_price: 0.0, invested: 5250, final_value: 0, realized_pnl: -5250, realized_pnl_pct: -100.0, roi: -100.0, closed_date: "2024-07-21T16:00:00Z", market_outcome: "YES" },
    { position_id: "f40", market_id: "m40", market_title: "Will Google split stock?", category: "Tech", side: "NO", shares: 27000, avg_entry_price: 0.42, exit_price: 1.0, invested: 11340, final_value: 27000, realized_pnl: 15660, realized_pnl_pct: 138.10, roi: 138.10, closed_date: "2024-08-05T14:20:00Z", market_outcome: "NO" },
    { position_id: "f41", market_id: "m41", market_title: "Will Kamala choose Walz?", category: "Politics", side: "YES", shares: 36000, avg_entry_price: 0.55, exit_price: 1.0, invested: 19800, final_value: 36000, realized_pnl: 16200, realized_pnl_pct: 81.82, roi: 81.82, closed_date: "2024-08-06T18:00:00Z", market_outcome: "YES" },
    { position_id: "f42", market_id: "m42", market_title: "Will Solana hit $200?", category: "Crypto", side: "YES", shares: 24000, avg_entry_price: 0.48, exit_price: 1.0, invested: 11520, final_value: 24000, realized_pnl: 12480, realized_pnl_pct: 108.33, roi: 108.33, closed_date: "2024-09-12T11:00:00Z", market_outcome: "YES" },
    { position_id: "f43", market_id: "m43", market_title: "Will Amazon workers strike?", category: "Finance", side: "NO", shares: 19000, avg_entry_price: 0.38, exit_price: 1.0, invested: 7220, final_value: 19000, realized_pnl: 11780, realized_pnl_pct: 163.16, roi: 163.16, closed_date: "2024-09-28T09:30:00Z", market_outcome: "NO" },
    { position_id: "f44", market_id: "m44", market_title: "Will Ohtani win MVP?", category: "Sports", side: "YES", shares: 31000, avg_entry_price: 0.72, exit_price: 1.0, invested: 22320, final_value: 31000, realized_pnl: 8680, realized_pnl_pct: 38.89, roi: 38.89, closed_date: "2024-10-03T21:00:00Z", market_outcome: "YES" },
    { position_id: "f45", market_id: "m45", market_title: "Will Joker 2 flop?", category: "Pop Culture", side: "YES", shares: 28000, avg_entry_price: 0.35, exit_price: 1.0, invested: 9800, final_value: 28000, realized_pnl: 18200, realized_pnl_pct: 185.71, roi: 185.71, closed_date: "2024-10-10T17:30:00Z", market_outcome: "YES" },
    { position_id: "f46", market_id: "m46", market_title: "Will Tesla hit production target?", category: "Tech", side: "NO", shares: 25000, avg_entry_price: 0.52, exit_price: 1.0, invested: 13000, final_value: 25000, realized_pnl: 12000, realized_pnl_pct: 92.31, roi: 92.31, closed_date: "2024-10-31T12:00:00Z", market_outcome: "NO" },
    { position_id: "f47", market_id: "m47", market_title: "Will Harris debate Trump again?", category: "Politics", side: "NO", shares: 22000, avg_entry_price: 0.28, exit_price: 1.0, invested: 6160, final_value: 22000, realized_pnl: 15840, realized_pnl_pct: 257.14, roi: 257.14, closed_date: "2024-11-01T19:00:00Z", market_outcome: "NO" },
    { position_id: "f48", market_id: "m48", market_title: "Will unemployment drop?", category: "Finance", side: "YES", shares: 20000, avg_entry_price: 0.62, exit_price: 1.0, invested: 12400, final_value: 20000, realized_pnl: 7600, realized_pnl_pct: 61.29, roi: 61.29, closed_date: "2024-11-08T14:00:00Z", market_outcome: "YES" },
    { position_id: "f49", market_id: "m49", market_title: "Will Dogecoin pump?", category: "Crypto", side: "YES", shares: 34000, avg_entry_price: 0.18, exit_price: 1.0, invested: 6120, final_value: 34000, realized_pnl: 27880, realized_pnl_pct: 455.56, roi: 455.56, closed_date: "2024-11-12T08:30:00Z", market_outcome: "YES" },
    { position_id: "f50", market_id: "m50", market_title: "Will new COVID variant spread?", category: "Pop Culture", side: "NO", shares: 23000, avg_entry_price: 0.45, exit_price: 1.0, invested: 10350, final_value: 23000, realized_pnl: 12650, realized_pnl_pct: 122.22, roi: 122.22, closed_date: "2024-12-01T15:00:00Z", market_outcome: "NO" },
    { position_id: "f51", market_id: "m51", market_title: "Will NHL have outdoor game?", category: "Sports", side: "YES", shares: 17000, avg_entry_price: 0.88, exit_price: 1.0, invested: 14960, final_value: 17000, realized_pnl: 2040, realized_pnl_pct: 13.64, roi: 13.64, closed_date: "2025-01-01T20:00:00Z", market_outcome: "YES" },
    { position_id: "f52", market_id: "m52", market_title: "Will Apple announce VR2?", category: "Tech", side: "NO", shares: 26000, avg_entry_price: 0.35, exit_price: 1.0, invested: 9100, final_value: 26000, realized_pnl: 16900, realized_pnl_pct: 185.71, roi: 185.71, closed_date: "2025-01-18T13:00:00Z", market_outcome: "NO" },
    { position_id: "f53", market_id: "m53", market_title: "Will Bitcoin break ATH?", category: "Crypto", side: "YES", shares: 38000, avg_entry_price: 0.62, exit_price: 1.0, invested: 23560, final_value: 38000, realized_pnl: 14440, realized_pnl_pct: 61.29, roi: 61.29, closed_date: "2025-02-14T10:30:00Z", market_outcome: "YES" },
    { position_id: "f54", market_id: "m54", market_title: "Will Fed pause rates?", category: "Finance", side: "NO", shares: 21000, avg_entry_price: 0.58, exit_price: 1.0, invested: 12180, final_value: 21000, realized_pnl: 8820, realized_pnl_pct: 72.41, roi: 72.41, closed_date: "2025-03-19T16:00:00Z", market_outcome: "NO" },
    { position_id: "f55", market_id: "m55", market_title: "Will Oscars have host?", category: "Pop Culture", side: "YES", shares: 19000, avg_entry_price: 0.72, exit_price: 1.0, invested: 13680, final_value: 19000, realized_pnl: 5320, realized_pnl_pct: 38.89, roi: 38.89, closed_date: "2025-03-27T22:00:00Z", market_outcome: "YES" },
    { position_id: "f56", market_id: "m56", market_title: "Will Trump tariffs pass?", category: "Politics", side: "YES", shares: 29000, avg_entry_price: 0.68, exit_price: 1.0, invested: 19720, final_value: 29000, realized_pnl: 9280, realized_pnl_pct: 47.06, roi: 47.06, closed_date: "2025-04-08T11:00:00Z", market_outcome: "YES" },
    { position_id: "f57", market_id: "m57", market_title: "Will Warriors make playoffs?", category: "Sports", side: "NO", shares: 24000, avg_entry_price: 0.42, exit_price: 0.0, invested: 10080, final_value: 0, realized_pnl: -10080, realized_pnl_pct: -100.0, roi: -100.0, closed_date: "2025-04-20T18:30:00Z", market_outcome: "YES" },
    { position_id: "f58", market_id: "m58", market_title: "Will Amazon split stock?", category: "Tech", side: "NO", shares: 22000, avg_entry_price: 0.48, exit_price: 1.0, invested: 10560, final_value: 22000, realized_pnl: 11440, realized_pnl_pct: 108.33, roi: 108.33, closed_date: "2025-05-12T09:00:00Z", market_outcome: "NO" },
    { position_id: "f59", market_id: "m59", market_title: "Will Ethereum hit $5k?", category: "Crypto", side: "YES", shares: 30000, avg_entry_price: 0.58, exit_price: 1.0, invested: 17400, final_value: 30000, realized_pnl: 12600, realized_pnl_pct: 72.41, roi: 72.41, closed_date: "2025-06-05T14:20:00Z", market_outcome: "YES" },
    { position_id: "f60", market_id: "m60", market_title: "Will housing market crash?", category: "Finance", side: "NO", shares: 27000, avg_entry_price: 0.32, exit_price: 1.0, invested: 8640, final_value: 27000, realized_pnl: 18360, realized_pnl_pct: 212.50, roi: 212.50, closed_date: "2025-07-15T12:00:00Z", market_outcome: "NO" },
    { position_id: "f61", market_id: "m61", market_title: "Will Avengers 5 delay?", category: "Pop Culture", side: "YES", shares: 25000, avg_entry_price: 0.55, exit_price: 1.0, invested: 13750, final_value: 25000, realized_pnl: 11250, realized_pnl_pct: 81.82, roi: 81.82, closed_date: "2025-08-22T17:00:00Z", market_outcome: "YES" },
    { position_id: "f62", market_id: "m62", market_title: "Will Chiefs threepeat?", category: "Sports", side: "YES", shares: 32000, avg_entry_price: 0.48, exit_price: 1.0, invested: 15360, final_value: 32000, realized_pnl: 16640, realized_pnl_pct: 108.33, roi: 108.33, closed_date: "2025-09-10T21:30:00Z", market_outcome: "YES" },
    { position_id: "f63", market_id: "m63", market_title: "Will OpenAI go public?", category: "Tech", side: "NO", shares: 28000, avg_entry_price: 0.38, exit_price: 1.0, invested: 10640, final_value: 28000, realized_pnl: 17360, realized_pnl_pct: 163.16, roi: 163.16, closed_date: "2025-09-28T10:00:00Z", market_outcome: "NO" },
    { position_id: "f64", market_id: "m64", market_title: "Will Ripple win SEC case?", category: "Crypto", side: "YES", shares: 26000, avg_entry_price: 0.62, exit_price: 1.0, invested: 16120, final_value: 26000, realized_pnl: 9880, realized_pnl_pct: 61.29, roi: 61.29, closed_date: "2025-10-08T15:45:00Z", market_outcome: "YES" },
  ];

  // Calculate best and worst trades
  const bestTrade = finishedBets.reduce((best, bet) =>
    bet.realized_pnl > best.realized_pnl ? bet : best
  , finishedBets[0]);

  const worstTrade = finishedBets.reduce((worst, bet) =>
    bet.realized_pnl < worst.realized_pnl ? bet : worst
  , finishedBets[0]);

  // Calculate totals for finished bets
  const finishedTotals = {
    invested: finishedBets.reduce((sum, bet) => sum + bet.invested, 0),
    final_value: finishedBets.reduce((sum, bet) => sum + bet.final_value, 0),
    realized_pnl: finishedBets.reduce((sum, bet) => sum + bet.realized_pnl, 0),
  };

  // Category stats for insights
  const categoryStats: CategoryStats[] = [
    { category: "Politics", trades: 45, volume: 85000, pnl: 18000, win_rate: 0.67, smart_score: 78 },
    { category: "Crypto", trades: 38, volume: 72000, pnl: 15000, win_rate: 0.63, smart_score: 72 },
    { category: "Sports", trades: 32, volume: 48000, pnl: 9500, win_rate: 0.59, smart_score: 65 },
    { category: "Finance", trades: 25, volume: 35000, pnl: 8200, win_rate: 0.64, smart_score: 70 },
    { category: "Pop Culture", trades: 16, volume: 22000, pnl: 6300, win_rate: 0.56, smart_score: 58 },
  ];

  // Entry preference buckets
  const entryBuckets: EntryBucket[] = [
    { bucket: "0.0-0.1", invested_usd: 12000, trade_count: 15 },
    { bucket: "0.1-0.2", invested_usd: 18000, trade_count: 22 },
    { bucket: "0.2-0.3", invested_usd: 25000, trade_count: 28 },
    { bucket: "0.3-0.4", invested_usd: 32000, trade_count: 35 },
    { bucket: "0.4-0.5", invested_usd: 45000, trade_count: 48 },
    { bucket: "0.5-0.6", invested_usd: 38000, trade_count: 42 },
    { bucket: "0.6-0.7", invested_usd: 28000, trade_count: 30 },
    { bucket: "0.7-0.8", invested_usd: 22000, trade_count: 24 },
    { bucket: "0.8-0.9", invested_usd: 18000, trade_count: 18 },
    { bucket: "0.9-1.0", invested_usd: 12000, trade_count: 14 },
  ];

  // Market distribution
  const marketDistribution: MarketDistributionItem[] = [
    { category: "Politics", trades: 45, volume: 85000, pnl: 18000, win_rate: 0.67 },
    { category: "Crypto", trades: 38, volume: 72000, pnl: 15000, win_rate: 0.63 },
    { category: "Sports", trades: 32, volume: 48000, pnl: 9500, win_rate: 0.59 },
    { category: "Finance", trades: 25, volume: 35000, pnl: 8200, win_rate: 0.64 },
    { category: "Pop Culture", trades: 16, volume: 22000, pnl: 6300, win_rate: 0.56 },
  ];

  // Comparison data
  const comparisons: WalletComparison[] = [
    { metric: "Total PnL %", wallet_value: 22.8, platform_avg: 8.5, top_10_pct_avg: 32.4, percentile: 78 },
    { metric: "Win Rate", wallet_value: 62.8, platform_avg: 52.3, top_10_pct_avg: 68.2, percentile: 72 },
    { metric: "WIS Score", wallet_value: 85, platform_avg: 50, top_10_pct_avg: 88, percentile: 89 },
    { metric: "Avg Trade Size", wallet_value: 1602, platform_avg: 450, top_10_pct_avg: 2100, percentile: 81 },
    { metric: "Markets Traded", wallet_value: 42, platform_avg: 12, top_10_pct_avg: 56, percentile: 76 },
  ];

  // PnL chart
  const pnlChartOption = {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
    },
    legend: {
      data: ["Realized PnL", "Unrealized PnL", "Total PnL"],
      bottom: 0,
    },
    xAxis: {
      type: "category",
      data: pnlHistory.map((p) => p.date),
      axisLabel: {
        formatter: (value: string) => {
          const date = new Date(value);
          return `${date.getMonth() + 1}/${date.getDate()}`;
        },
      },
    },
    yAxis: {
      type: "value",
      name: "PnL (USD)",
      axisLabel: {
        formatter: (value: number) => `$${(value / 1000).toFixed(0)}k`,
      },
    },
    series: [
      {
        name: "Realized PnL",
        type: "line",
        data: pnlHistory.map((p) => p.realized_pnl),
        smooth: true,
        itemStyle: { color: "#10b981" },
      },
      {
        name: "Unrealized PnL",
        type: "line",
        data: pnlHistory.map((p) => p.unrealized_pnl),
        smooth: true,
        itemStyle: { color: "#f59e0b" },
      },
      {
        name: "Total PnL",
        type: "line",
        data: pnlHistory.map((p) => p.total_pnl),
        smooth: true,
        itemStyle: { color: "#3b82f6" },
        lineStyle: { width: 3 },
      },
    ],
  };

  // Win rate chart
  const winRateChartOption = {
    tooltip: {
      trigger: "axis",
    },
    xAxis: {
      type: "category",
      data: winRateHistory.map((w) => w.date),
      axisLabel: {
        formatter: (value: string) => {
          const date = new Date(value);
          return `${date.getMonth() + 1}/${date.getDate()}`;
        },
      },
    },
    yAxis: {
      type: "value",
      name: "Win Rate",
      min: 0,
      max: 1,
      axisLabel: {
        formatter: (value: number) => `${(value * 100).toFixed(0)}%`,
      },
    },
    series: [
      {
        type: "line",
        data: winRateHistory.map((w) => w.win_rate),
        smooth: true,
        itemStyle: { color: "#8b5cf6" },
        areaStyle: { color: "rgba(139, 92, 246, 0.1)" },
      },
    ],
  };

  // Market distribution chart
  const distributionChartOption = {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
    },
    legend: {
      data: ["Volume", "PnL"],
      bottom: 0,
    },
    xAxis: {
      type: "category",
      data: marketDistribution.map((m) => m.category),
    },
    yAxis: [
      {
        type: "value",
        name: "Volume (USD)",
        position: "left",
        axisLabel: {
          formatter: (value: number) => `$${(value / 1000).toFixed(0)}k`,
        },
      },
      {
        type: "value",
        name: "PnL (USD)",
        position: "right",
        axisLabel: {
          formatter: (value: number) => `$${(value / 1000).toFixed(0)}k`,
        },
      },
    ],
    series: [
      {
        name: "Volume",
        type: "bar",
        data: marketDistribution.map((m) => m.volume),
        itemStyle: { color: "#3b82f6" },
        yAxisIndex: 0,
      },
      {
        name: "PnL",
        type: "bar",
        data: marketDistribution.map((m) => m.pnl),
        itemStyle: { color: "#10b981" },
        yAxisIndex: 1,
      },
    ],
  };

  const formatAddress = (addr: string) => {
    if (addr.length < 10) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const copyAddress = () => {
    navigator.clipboard.writeText(wallet.wallet_address);
  };

  const getWISBadge = (wis: number) => {
    if (wis >= 80) return <Badge className="bg-purple-600">Elite (WIS {wis})</Badge>;
    if (wis >= 60) return <Badge className="bg-blue-600">Expert (WIS {wis})</Badge>;
    if (wis >= 40) return <Badge className="bg-green-600">Skilled (WIS {wis})</Badge>;
    return <Badge variant="secondary">WIS {wis}</Badge>;
  };

  const getSharpeLevelBadge = (level: string) => {
    if (level === 'Excellent') return <Badge className="bg-green-600">Excellent (≥2.0)</Badge>;
    if (level === 'Good') return <Badge className="bg-blue-600">Good (≥1.0)</Badge>;
    if (level === 'Fair') return <Badge className="bg-yellow-600">Fair (≥0.5)</Badge>;
    return <Badge variant="destructive">Poor (&lt;0.5)</Badge>;
  };

  // 30d traded volume chart
  const volumeChartOption = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const data = params[0];
        return `
          <div style="padding: 8px;">
            <div><strong>${new Date(data.name).toLocaleDateString()}</strong></div>
            <div style="margin-top: 4px;">
              Volume: <strong>$${(data.value / 1000).toFixed(1)}k</strong>
            </div>
          </div>
        `;
      },
    },
    xAxis: {
      type: 'category',
      data: wallet.risk_metrics?.traded_volume_30d_daily.map((d) => d.date) || [],
      show: false,
    },
    yAxis: {
      type: 'value',
      show: false,
    },
    grid: {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    },
    series: [
      {
        type: 'line',
        data: wallet.risk_metrics?.traded_volume_30d_daily.map((d) => d.volume_usd) || [],
        smooth: true,
        symbol: 'none',
        lineStyle: {
          color: '#3b82f6',
          width: 2,
        },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(59, 130, 246, 0.3)' },
              { offset: 1, color: 'rgba(59, 130, 246, 0.05)' },
            ],
          },
        },
      },
    ],
  };

  return (
    <div className="flex flex-col h-full space-y-4 p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <Wallet className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">{wallet.wallet_alias}</h1>
            {getWISBadge(wallet.wis)}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-muted-foreground font-mono">{formatAddress(wallet.wallet_address)}</p>
            <Button variant="ghost" size="sm" onClick={copyAddress} className="h-6 px-2">
              <Copy className="h-3 w-3" />
            </Button>
          </div>
          {/* Quick Badge Summary */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge variant="outline" className="text-xs">
              {[
                wallet.bagholder_pct >= 50,
                wallet.lottery_ticket_count > 0,
                wallet.contrarian_pct >= 50,
                wallet.is_senior,
                wallet.whale_splash_count > 0,
                wallet.is_millionaire,
                wallet.reverse_cramer_count > 0
              ].filter(Boolean).length} Trading Traits
            </Badge>
          </div>
        </div>
      </div>

      {/* Performance Metrics Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Total PnL</div>
          <div className={`text-2xl font-bold ${wallet.total_pnl >= 0 ? "text-green-600" : "text-red-600"}`}>
            ${(wallet.total_pnl / 1000).toFixed(1)}k
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            {wallet.total_pnl_pct >= 0 ? <TrendingUp className="h-3 w-3 text-green-600" /> : <TrendingDown className="h-3 w-3 text-red-600" />}
            {wallet.total_pnl_pct >= 0 ? "+" : ""}{wallet.total_pnl_pct.toFixed(1)}%
          </div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Win Rate</div>
          <div className="text-2xl font-bold">{(wallet.win_rate * 100).toFixed(1)}%</div>
          <div className="text-xs text-muted-foreground">{wallet.winning_trades}W / {wallet.losing_trades}L</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Total Trades</div>
          <div className="text-2xl font-bold">{wallet.total_trades}</div>
          <div className="text-xs text-muted-foreground">{wallet.markets_traded} markets</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Invested</div>
          <div className="text-2xl font-bold">${(wallet.total_invested / 1000).toFixed(0)}k</div>
          <div className="text-xs text-muted-foreground">{wallet.active_positions} active</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Avg Trade</div>
          <div className="text-2xl font-bold">${wallet.avg_trade_size.toFixed(0)}</div>
          <div className="text-xs text-muted-foreground">per trade</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Best Win</div>
          <div className="text-2xl font-bold text-green-600">${(wallet.largest_win / 1000).toFixed(1)}k</div>
          <div className="text-xs text-muted-foreground">single trade</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">PnL Rank</div>
          <div className="text-2xl font-bold flex items-center gap-1">
            <Trophy className="h-5 w-5 text-yellow-500" />
            #{wallet.rank_by_pnl}
          </div>
          <div className="text-xs text-muted-foreground">leaderboard</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-sm text-muted-foreground">Days Active</div>
          <div className="text-2xl font-bold">{wallet.days_active}</div>
          <div className="text-xs text-muted-foreground">since {new Date(wallet.first_trade_date).toLocaleDateString()}</div>
        </div>
      </div>

      {/* Trading DNA Section */}
      <div className="border rounded-lg p-6 bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950/20 dark:to-blue-950/20">
        <div className="flex items-center gap-3 mb-4">
          <Award className="h-6 w-6 text-purple-600" />
          <h2 className="text-xl font-bold">Trading DNA</h2>
          <Badge variant="outline" className="ml-auto">
            {[
              wallet.bagholder_pct >= 50,
              wallet.lottery_ticket_count > 0,
              wallet.contrarian_pct >= 50,
              wallet.is_senior,
              wallet.whale_splash_count > 0,
              wallet.is_millionaire,
              wallet.reverse_cramer_count > 0
            ].filter(Boolean).length} Traits Identified
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Bagholder Badge */}
          {wallet.bagholder_pct >= 50 && (
            <div className="group relative border rounded-xl p-4 bg-white dark:bg-gray-900 hover:shadow-lg transition-all cursor-pointer">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                    <TrendingDown className="h-5 w-5 text-red-600 dark:text-red-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Bagholder</h3>
                    <p className="text-xs text-muted-foreground">Position Holder</p>
                  </div>
                </div>
                <Badge variant="outline" className="bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800">
                  {wallet.bagholder_pct.toFixed(1)}%
                </Badge>
              </div>

              <div className="mb-3">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Positions below entry</span>
                  <span className="font-medium">{wallet.bagholder_pct.toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-red-500 to-red-600 rounded-full transition-all"
                    style={{ width: `${wallet.bagholder_pct}%` }}
                  />
                </div>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                Holds positions that have declined in value. This trader demonstrates patience and conviction, maintaining positions despite adverse price movements.
              </p>

              <div className="absolute inset-0 border-2 border-red-400 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            </div>
          )}

          {/* Lottery Ticket Badge */}
          {wallet.lottery_ticket_count > 0 && (
            <div className="group relative border rounded-xl p-4 bg-white dark:bg-gray-900 hover:shadow-lg transition-all cursor-pointer">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                    <Zap className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Lottery Ticket</h3>
                    <p className="text-xs text-muted-foreground">Moonshot Hunter</p>
                  </div>
                </div>
                <Badge variant="outline" className="bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800">
                  {wallet.lottery_ticket_count}
                </Badge>
              </div>

              <div className="mb-3 flex gap-1">
                {Array.from({ length: Math.min(5, wallet.lottery_ticket_count) }).map((_, i) => (
                  <Star key={i} className="h-4 w-4 text-purple-500 fill-purple-500" />
                ))}
                {wallet.lottery_ticket_count > 5 && (
                  <span className="text-xs text-purple-600 ml-1">+{wallet.lottery_ticket_count - 5}</span>
                )}
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                Bought extremely unlikely outcomes (under 20%) that surged to near certainty (over 90%). High-risk, high-reward strategy paying off.
              </p>

              <div className="absolute inset-0 border-2 border-purple-400 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            </div>
          )}

          {/* Contrarian Badge */}
          {wallet.contrarian_pct >= 50 && (
            <div className="group relative border rounded-xl p-4 bg-white dark:bg-gray-900 hover:shadow-lg transition-all cursor-pointer">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
                    <Target className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Contrarian</h3>
                    <p className="text-xs text-muted-foreground">Against the Crowd</p>
                  </div>
                </div>
                <Badge variant="outline" className="bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800">
                  {wallet.contrarian_pct}%
                </Badge>
              </div>

              <div className="mb-3">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Underdog bets</span>
                  <span className="font-medium">{wallet.contrarian_pct}%</span>
                </div>
                <div className="h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-orange-500 to-orange-600 rounded-full"
                    style={{ width: `${wallet.contrarian_pct}%` }}
                  />
                </div>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                Prefers betting against the consensus. Enters positions priced below 50%, seeking value where others see risk.
              </p>

              <div className="absolute inset-0 border-2 border-orange-400 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            </div>
          )}

          {/* Whale Splash Badge */}
          {wallet.whale_splash_count > 0 && (
            <div className="group relative border rounded-xl p-4 bg-white dark:bg-gray-900 hover:shadow-lg transition-all cursor-pointer">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-cyan-100 dark:bg-cyan-900/30">
                    <Activity className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Whale Splash</h3>
                    <p className="text-xs text-muted-foreground">Big Money Moves</p>
                  </div>
                </div>
                <Badge variant="outline" className="bg-cyan-50 dark:bg-cyan-950/30 text-cyan-700 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800">
                  {wallet.whale_splash_count}
                </Badge>
              </div>

              <div className="mb-3 grid grid-cols-5 gap-1">
                {Array.from({ length: Math.min(10, wallet.whale_splash_count) }).map((_, i) => (
                  <div
                    key={i}
                    className="bg-gradient-to-t from-cyan-600 to-cyan-400 rounded"
                    style={{
                      height: `${Math.min(24, 12 + (i % 5) * 3)}px`,
                      opacity: 0.7 + (i % 5) * 0.06
                    }}
                  />
                ))}
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                Makes market-moving bets over $20k. High conviction positions that demonstrate serious capital deployment.
              </p>

              <div className="absolute inset-0 border-2 border-cyan-400 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            </div>
          )}

          {/* Millionaire Badge */}
          {wallet.is_millionaire && (
            <div className="group relative border rounded-xl p-4 bg-white dark:bg-gray-900 hover:shadow-lg transition-all cursor-pointer">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-900/30">
                    <DollarSign className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Millionaire</h3>
                    <p className="text-xs text-muted-foreground">Elite Capital</p>
                  </div>
                </div>
                <Badge variant="outline" className="bg-yellow-50 dark:bg-yellow-950/30 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800">
                  $1M+
                </Badge>
              </div>

              <div className="mb-3 flex justify-center">
                <Trophy className="h-12 w-12 text-yellow-500 fill-yellow-100 dark:fill-yellow-950" />
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                Total lifetime capital deployed exceeds $1 million. Part of the platform's most serious institutional traders.
              </p>

              <div className="absolute inset-0 border-2 border-yellow-400 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            </div>
          )}

          {/* Reverse Cramer Badge */}
          {wallet.reverse_cramer_count > 0 && (
            <div className="group relative border rounded-xl p-4 bg-white dark:bg-gray-900 hover:shadow-lg transition-all cursor-pointer">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-pink-100 dark:bg-pink-900/30">
                    <TrendingUp className="h-5 w-5 text-pink-600 dark:text-pink-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Reverse Cramer</h3>
                    <p className="text-xs text-muted-foreground">Contrarian Winner</p>
                  </div>
                </div>
                <Badge variant="outline" className="bg-pink-50 dark:bg-pink-950/30 text-pink-700 dark:text-pink-400 border-pink-200 dark:border-pink-800">
                  {wallet.reverse_cramer_count}
                </Badge>
              </div>

              <div className="mb-3 flex items-center justify-center gap-2">
                <div className="text-center">
                  <div className="text-xs text-muted-foreground mb-1">Entry</div>
                  <div className="text-lg font-bold text-red-600">&gt;80%</div>
                </div>
                <div className="flex flex-col gap-1">
                  <ArrowLeft className="h-4 w-4 text-pink-500 transform rotate-180" />
                  <ArrowLeft className="h-4 w-4 text-pink-500" />
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground mb-1">Now</div>
                  <div className="text-lg font-bold text-green-600">&lt;10%</div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                Faded the consensus when certainty peaked. Bet against outcomes priced over 80% that collapsed below 10%.
              </p>

              <div className="absolute inset-0 border-2 border-pink-400 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            </div>
          )}

          {/* Senior Badge */}
          {wallet.is_senior && (
            <div className="group relative border rounded-xl p-4 bg-white dark:bg-gray-900 hover:shadow-lg transition-all cursor-pointer">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                    <Medal className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Senior Trader</h3>
                    <p className="text-xs text-muted-foreground">Veteran Status</p>
                  </div>
                </div>
                <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800">
                  1k+
                </Badge>
              </div>

              <div className="mb-3 space-y-1">
                {[100, 85, 70, 55, 40].map((width, i) => (
                  <div
                    key={i}
                    className="h-1.5 bg-blue-500 rounded"
                    style={{ width: `${width}%`, opacity: 1 - (i * 0.15) }}
                  />
                ))}
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                Opened over 1,000 total positions. Extensive market experience across diverse categories and conditions.
              </p>

              <div className="absolute inset-0 border-2 border-blue-400 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            </div>
          )}
        </div>

        {/* Trading Style Summary */}
        <div className="mt-6 p-4 rounded-lg bg-white dark:bg-gray-900 border-l-4 border-purple-500">
          <h3 className="font-semibold mb-2 flex items-center gap-2">
            <Star className="h-4 w-4 text-purple-600" />
            Trading Personality Profile
          </h3>
          <p className="text-sm text-muted-foreground">
            {wallet.contrarian_pct >= 50 && wallet.lottery_ticket_count > 0 ? (
              "A bold contrarian who hunts undervalued opportunities. Takes calculated risks on unlikely outcomes and holds conviction through market volatility."
            ) : wallet.whale_splash_count > 100 && wallet.is_millionaire ? (
              "An institutional-scale operator deploying significant capital with high conviction. Demonstrates patience and deep market analysis."
            ) : wallet.bagholder_pct >= 60 ? (
              "A patient value investor willing to weather unrealized losses. Maintains long-term positions despite short-term price movements."
            ) : (
              "A balanced trader combining various strategies. Adapts approach based on market conditions and opportunity assessment."
            )}
          </p>
        </div>
      </div>

      {/* Leaderboard Performance */}
      {wallet.pnl_ranks && (
        <div className="border rounded-lg p-6 bg-gradient-to-br from-slate-50 to-gray-50 dark:from-slate-950/20 dark:to-gray-950/20">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Trophy className="h-6 w-6 text-yellow-500" />
              <div>
                <h3 className="text-lg font-semibold">Leaderboard Performance</h3>
                <p className="text-sm text-muted-foreground">Your ranking trajectory across timeframes</p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Current Rank</div>
              <div className="text-3xl font-bold text-primary">#{wallet.rank_by_pnl}</div>
            </div>
          </div>

          {/* Timeline Visualization */}
          <div className="relative mb-6">
            {/* Connecting line */}
            <div className="absolute top-12 left-0 right-0 h-0.5 bg-gradient-to-r from-gray-300 via-blue-400 to-purple-400 dark:from-gray-700 dark:via-blue-600 dark:to-purple-600" />

            <div className="grid grid-cols-4 gap-4 relative">
              {[wallet.pnl_ranks.d1, wallet.pnl_ranks.d7, wallet.pnl_ranks.d30, wallet.pnl_ranks.all].map((rank, index) => {
                const rankArray = [wallet.pnl_ranks!.d1, wallet.pnl_ranks!.d7, wallet.pnl_ranks!.d30, wallet.pnl_ranks!.all];
                const isImproving = index > 0 && rank.rank < rankArray[index - 1].rank;
                const isDeclining = index > 0 && rank.rank > rankArray[index - 1].rank;

                return (
                  <div key={rank.period} className="flex flex-col items-center">
                    <div className="text-xs font-medium text-muted-foreground mb-2">
                      {rank.period}
                    </div>

                    <div className="relative group">
                      <div className={`
                        w-20 h-20 rounded-full flex flex-col items-center justify-center
                        bg-gradient-to-br shadow-lg cursor-pointer
                        transform transition-all duration-300 hover:scale-110 hover:shadow-xl
                        ${index === 3 ? 'from-purple-500 to-purple-600 ring-4 ring-purple-200 dark:ring-purple-800' :
                          index === 2 ? 'from-blue-500 to-blue-600' :
                          index === 1 ? 'from-cyan-500 to-cyan-600' :
                          'from-gray-500 to-gray-600'}
                      `}>
                        <div className="text-white text-2xl font-bold">#{rank.rank}</div>
                        {index > 0 && (
                          <div className="absolute -top-2 -right-2">
                            {isImproving ? (
                              <div className="bg-green-500 rounded-full p-1">
                                <TrendingUp className="h-3 w-3 text-white" />
                              </div>
                            ) : isDeclining ? (
                              <div className="bg-red-500 rounded-full p-1">
                                <TrendingDown className="h-3 w-3 text-white" />
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>

                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                        <div className="bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs rounded-lg py-2 px-3 whitespace-nowrap">
                          <div className="font-semibold">Rank #{rank.rank}</div>
                          <div className={rank.pnl_usd >= 0 ? 'text-green-400 dark:text-green-600' : 'text-red-400 dark:text-red-600'}>
                            {rank.pnl_usd >= 0 ? '+' : ''}${(rank.pnl_usd / 1000).toFixed(1)}k PnL
                          </div>
                          {index > 0 && (
                            <div className="text-gray-400 dark:text-gray-600 mt-1">
                              {isImproving ? '↑ Improving' : isDeclining ? '↓ Declining' : '→ Stable'}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className={`mt-3 text-center font-semibold ${rank.pnl_usd >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {rank.pnl_usd >= 0 ? '+' : ''}${(rank.pnl_usd / 1000).toFixed(1)}k
                    </div>

                    {index > 0 && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {isImproving && (
                          <span className="text-green-600 dark:text-green-400">
                            +{rankArray[index - 1].rank - rank.rank} spots
                          </span>
                        )}
                        {isDeclining && (
                          <span className="text-red-600 dark:text-red-400">
                            -{rank.rank - rankArray[index - 1].rank} spots
                          </span>
                        )}
                        {!isImproving && !isDeclining && (
                          <span className="text-gray-600 dark:text-gray-400">No change</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Context & Percentile */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
            <div className="border rounded-lg p-4 bg-white dark:bg-gray-900">
              <div className="text-sm text-muted-foreground mb-2">Percentile Rank</div>
              <div className="flex items-end gap-2 mb-2">
                <div className="text-3xl font-bold text-blue-600">
                  {((1 - wallet.rank_by_pnl / 1000) * 100).toFixed(1)}%
                </div>
                <div className="text-sm text-muted-foreground mb-1">Top</div>
              </div>
              <div className="h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-purple-500"
                  style={{ width: `${((1 - wallet.rank_by_pnl / 1000) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Outperforming {((1 - wallet.rank_by_pnl / 1000) * 100).toFixed(0)}% of all traders
              </p>
            </div>

            <div className="border rounded-lg p-4 bg-white dark:bg-gray-900">
              <div className="text-sm text-muted-foreground mb-2">Total Leaderboard</div>
              <div className="text-3xl font-bold">~1,000</div>
              <p className="text-sm text-muted-foreground mt-1">Active traders</p>
              <div className="mt-3 flex items-center gap-2 text-xs">
                <div className="flex-1 h-1 bg-gray-300 dark:bg-gray-700 rounded-full relative">
                  <div
                    className="absolute h-full w-1 bg-blue-600 rounded-full"
                    style={{ left: `${(wallet.rank_by_pnl / 1000) * 100}%` }}
                  />
                </div>
                <span className="text-muted-foreground">Your position</span>
              </div>
            </div>

            <div className="border rounded-lg p-4 bg-white dark:bg-gray-900">
              <div className="text-sm text-muted-foreground mb-2">Recent Momentum</div>
              <div className="flex items-center gap-2">
                {wallet.pnl_ranks!.d1.rank < wallet.pnl_ranks!.d7.rank ? (
                  <>
                    <TrendingUp className="h-8 w-8 text-green-600" />
                    <div>
                      <div className="font-semibold text-green-600">Climbing</div>
                      <div className="text-xs text-muted-foreground">
                        Up {wallet.pnl_ranks!.d7.rank - wallet.pnl_ranks!.d1.rank} spots this week
                      </div>
                    </div>
                  </>
                ) : wallet.pnl_ranks!.d1.rank > wallet.pnl_ranks!.d7.rank ? (
                  <>
                    <TrendingDown className="h-8 w-8 text-red-600" />
                    <div>
                      <div className="font-semibold text-red-600">Slipping</div>
                      <div className="text-xs text-muted-foreground">
                        Down {wallet.pnl_ranks!.d1.rank - wallet.pnl_ranks!.d7.rank} spots this week
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <Activity className="h-8 w-8 text-blue-600" />
                    <div>
                      <div className="font-semibold text-blue-600">Stable</div>
                      <div className="text-xs text-muted-foreground">
                        Maintaining position
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Achievement Badges */}
          <div className="mt-4 flex flex-wrap gap-2">
            {wallet.rank_by_pnl <= 10 && (
              <Badge className="bg-gradient-to-r from-yellow-500 to-yellow-600">
                <Trophy className="h-3 w-3 mr-1" />
                Top 10 Elite
              </Badge>
            )}
            {wallet.rank_by_pnl <= 50 && wallet.rank_by_pnl > 10 && (
              <Badge className="bg-gradient-to-r from-purple-500 to-purple-600">
                <Medal className="h-3 w-3 mr-1" />
                Top 50 Performer
              </Badge>
            )}
            {wallet.rank_by_pnl <= 100 && wallet.rank_by_pnl > 50 && (
              <Badge className="bg-gradient-to-r from-blue-500 to-blue-600">
                <Star className="h-3 w-3 mr-1" />
                Top 100 Trader
              </Badge>
            )}
            {wallet.pnl_ranks!.all.pnl_usd > 50000 && (
              <Badge variant="outline" className="border-green-500 text-green-600">
                <DollarSign className="h-3 w-3 mr-1" />
                $50k+ Club
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Risk Metrics */}
      {wallet.risk_metrics && (
        <div className="border rounded-lg p-4">
          <h3 className="text-lg font-semibold mb-3">Risk Metrics</h3>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">Sharpe Ratio (30d)</span>
                {getSharpeLevelBadge(wallet.risk_metrics.sharpe_level)}
              </div>
              <div className="text-3xl font-bold">{wallet.risk_metrics.sharpe_ratio_30d.toFixed(2)}</div>
              <div className="text-xs text-muted-foreground">Annualized (sqrt 252)</div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">Traded Volume (30d)</span>
                <span className="text-sm font-bold">${(wallet.risk_metrics.traded_volume_30d_total / 1000).toFixed(0)}k</span>
              </div>
              <div className="h-[60px]">
                <ReactECharts
                  option={volumeChartOption}
                  style={{ height: '100%', width: '100%' }}
                  opts={{ renderer: 'canvas' }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Performance Snapshot */}
      <div className="border rounded-lg overflow-hidden bg-white dark:bg-gray-900">
        <div className="p-6 pb-0">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold mb-1">Performance Snapshot</h2>
              <p className="text-sm text-muted-foreground">90-day profit & loss trajectory</p>
            </div>

            {/* Key Stats Sidebar */}
            <div className="grid grid-cols-2 gap-4 text-right">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Current Total</div>
                <div className={`text-2xl font-bold ${wallet.total_pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {wallet.total_pnl >= 0 ? '+' : ''}${(wallet.total_pnl / 1000).toFixed(1)}k
                </div>
                <div className="text-xs text-muted-foreground">
                  {wallet.total_pnl_pct >= 0 ? '+' : ''}{wallet.total_pnl_pct.toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">90d Change</div>
                <div className={`text-2xl font-bold ${(pnlHistory[pnlHistory.length - 1].total_pnl - pnlHistory[0].total_pnl) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {(pnlHistory[pnlHistory.length - 1].total_pnl - pnlHistory[0].total_pnl) >= 0 ? '+' : ''}
                  ${((pnlHistory[pnlHistory.length - 1].total_pnl - pnlHistory[0].total_pnl) / 1000).toFixed(1)}k
                </div>
                <div className="text-xs text-muted-foreground">
                  {(((pnlHistory[pnlHistory.length - 1].total_pnl - pnlHistory[0].total_pnl) / Math.abs(pnlHistory[0].total_pnl)) * 100).toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Simplified Chart */}
        <div className="h-[280px] px-6">
          <ReactECharts
            option={{
              grid: {
                left: 60,
                right: 20,
                top: 20,
                bottom: 40,
                containLabel: false,
              },
              tooltip: {
                trigger: 'axis',
                axisPointer: {
                  type: 'line',
                  lineStyle: {
                    color: '#6b7280',
                    type: 'dashed',
                  },
                },
                backgroundColor: 'rgba(0, 0, 0, 0.9)',
                borderColor: 'transparent',
                textStyle: {
                  color: '#ffffff',
                  fontSize: 13,
                },
                formatter: (params: any) => {
                  const data = params[0];
                  const date = new Date(data.name);
                  const value = data.value;
                  return `
                    <div style="padding: 8px;">
                      <div style="font-weight: 600; margin-bottom: 4px;">
                        ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                      <div style="font-size: 16px; font-weight: 700; color: ${value >= 0 ? '#10b981' : '#ef4444'};">
                        ${value >= 0 ? '+' : ''}$${(value / 1000).toFixed(2)}k
                      </div>
                    </div>
                  `;
                },
              },
              xAxis: {
                type: 'category',
                data: pnlHistory.map((p) => p.date),
                boundaryGap: false,
                axisLine: {
                  lineStyle: {
                    color: '#e5e7eb',
                  },
                },
                axisLabel: {
                  color: '#9ca3af',
                  fontSize: 11,
                  formatter: (value: string) => {
                    const date = new Date(value);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                  },
                  interval: Math.floor(pnlHistory.length / 6),
                },
                axisTick: {
                  show: false,
                },
              },
              yAxis: {
                type: 'value',
                axisLine: {
                  show: false,
                },
                axisTick: {
                  show: false,
                },
                axisLabel: {
                  color: '#9ca3af',
                  fontSize: 11,
                  formatter: (value: number) => {
                    if (value === 0) return '$0';
                    return `${value >= 0 ? '+' : ''}$${(value / 1000).toFixed(0)}k`;
                  },
                },
                splitLine: {
                  lineStyle: {
                    color: '#f3f4f6',
                    type: 'dashed',
                  },
                },
              },
              series: [
                {
                  type: 'line',
                  data: pnlHistory.map((p) => p.total_pnl),
                  smooth: true,
                  symbol: 'none',
                  lineStyle: {
                    width: 3,
                    color: wallet.total_pnl >= 0 ? '#10b981' : '#ef4444',
                  },
                  areaStyle: {
                    color: {
                      type: 'linear',
                      x: 0,
                      y: 0,
                      x2: 0,
                      y2: 1,
                      colorStops: [
                        {
                          offset: 0,
                          color: wallet.total_pnl >= 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        },
                        {
                          offset: 1,
                          color: wallet.total_pnl >= 0 ? 'rgba(16, 185, 129, 0.01)' : 'rgba(239, 68, 68, 0.01)',
                        },
                      ],
                    },
                  },
                },
                {
                  type: 'line',
                  data: pnlHistory.map(() => 0),
                  symbol: 'none',
                  lineStyle: {
                    width: 2,
                    color: '#9ca3af',
                    type: 'solid',
                  },
                  z: 0,
                },
              ],
            }}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
        </div>

        {/* Quick Insights Bar */}
        <div className="border-t bg-gray-50 dark:bg-gray-950/50 p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Best Day</div>
              <div className="text-lg font-bold text-green-600">
                +${(Math.max(...pnlHistory.map((p, i) => i > 0 ? p.total_pnl - pnlHistory[i-1].total_pnl : 0)) / 1000).toFixed(1)}k
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Worst Day</div>
              <div className="text-lg font-bold text-red-600">
                ${(Math.min(...pnlHistory.map((p, i) => i > 0 ? p.total_pnl - pnlHistory[i-1].total_pnl : 0)) / 1000).toFixed(1)}k
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Profitable Days</div>
              <div className="text-lg font-bold text-blue-600">
                {pnlHistory.filter((p, i) => i > 0 && p.total_pnl > pnlHistory[i-1].total_pnl).length}/{pnlHistory.length}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Trend</div>
              <div className="flex items-center justify-center gap-1">
                {(() => {
                  const recentTrend = pnlHistory.slice(-7);
                  const increasing = recentTrend[recentTrend.length - 1].total_pnl > recentTrend[0].total_pnl;
                  return increasing ? (
                    <>
                      <TrendingUp className="h-5 w-5 text-green-600" />
                      <span className="text-lg font-bold text-green-600">Up</span>
                    </>
                  ) : (
                    <>
                      <TrendingDown className="h-5 w-5 text-red-600" />
                      <span className="text-lg font-bold text-red-600">Down</span>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Performance Overview */}
      <div className="space-y-4">

          {/* Win Rate Chart */}
          <div className="border rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-4">Win Rate Trend (90 Days)</h2>
            <div className="h-[250px]">
              <ReactECharts
                option={winRateChartOption}
                style={{ height: "100%", width: "100%" }}
                opts={{ renderer: "canvas" }}
              />
            </div>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border rounded-lg p-4">
              <h3 className="text-md font-semibold mb-3">Recent Performance</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Last 7 days:</span>
                  <span className="text-sm font-bold text-green-600">+$4.2k</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Last 30 days:</span>
                  <span className="text-sm font-bold text-green-600">+$12.8k</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Last 90 days:</span>
                  <span className="text-sm font-bold text-green-600">+$28.5k</span>
                </div>
              </div>
            </div>

            <div className="border rounded-lg p-4">
              <h3 className="text-md font-semibold mb-3">Trading Activity</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Trades this week:</span>
                  <span className="text-sm font-bold">12</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Trades this month:</span>
                  <span className="text-sm font-bold">45</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Avg per week:</span>
                  <span className="text-sm font-bold">3.9</span>
                </div>
              </div>
            </div>

            <div className="border rounded-lg p-4">
              <h3 className="text-md font-semibold mb-3">Risk Metrics</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Max drawdown:</span>
                  <span className="text-sm font-bold text-red-600">-$8.2k</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Sharpe ratio:</span>
                  <span className="text-sm font-bold">1.85</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Avg hold time:</span>
                  <span className="text-sm font-bold">4.2 days</span>
                </div>
              </div>
            </div>
          </div>
      </div>

      {/* Trading History */}
      <div className="space-y-4">
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Market</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Shares</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>PnL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tradingHistory.map((trade) => (
                  <TableRow key={trade.trade_id}>
                    <TableCell className="text-xs">{new Date(trade.timestamp).toLocaleString()}</TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      <Link
                        href={`/analysis/market/${trade.market_id}`}
                        className="font-medium text-blue-600 hover:underline cursor-pointer"
                      >
                        {trade.market_title}
                      </Link>
                    </TableCell>
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
                    <TableCell>{(trade.price * 100).toFixed(1)}¢</TableCell>
                    <TableCell>${trade.amount_usd.toLocaleString()}</TableCell>
                    <TableCell>
                      {trade.market_outcome === "OPEN" ? (
                        <Badge variant="outline">OPEN</Badge>
                      ) : (
                        <Badge variant={trade.market_outcome === trade.side ? "default" : "destructive"}>
                          {trade.market_outcome}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {trade.pnl !== null ? (
                        <span className={trade.pnl >= 0 ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                          {trade.pnl >= 0 ? "+" : ""}${trade.pnl.toLocaleString()} ({trade.pnl_pct?.toFixed(1)}%)
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
      </div>

      {/* Positions */}
      <div className="space-y-6">
          {/* Active Bets Section */}
          <div>
            <h2 className="text-lg font-semibold mb-3">Active Bets ({activeBets.length})</h2>
            <div className="border rounded-lg overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Market</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead>Shares</TableHead>
                    <TableHead>Entry Price</TableHead>
                    <TableHead>Current Price</TableHead>
                    <TableHead>Invested</TableHead>
                    <TableHead>Current Value</TableHead>
                    <TableHead>PnL</TableHead>
                    <TableHead>Closes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeBets.map((bet) => (
                    <TableRow key={bet.position_id}>
                      <TableCell className="max-w-[250px]">
                        <Link
                          href={`/analysis/market/${bet.market_id}`}
                          className="font-medium text-blue-600 hover:underline cursor-pointer"
                        >
                          {bet.market_title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{bet.category}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={bet.side === "YES" ? "default" : "destructive"}>
                          {bet.side}
                        </Badge>
                      </TableCell>
                      <TableCell>{bet.shares.toLocaleString()}</TableCell>
                      <TableCell>{(bet.avg_entry_price * 100).toFixed(1)}¢</TableCell>
                      <TableCell>{(bet.current_price * 100).toFixed(1)}¢</TableCell>
                      <TableCell>${bet.invested.toLocaleString()}</TableCell>
                      <TableCell>${bet.current_value.toLocaleString()}</TableCell>
                      <TableCell className={bet.unrealized_pnl >= 0 ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                        {bet.unrealized_pnl >= 0 ? "+" : ""}${bet.unrealized_pnl.toLocaleString()} ({bet.unrealized_pnl_pct.toFixed(2)}%)
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(bet.market_end_date).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Finished Bets Section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Finished Bets ({finishedBets.length})</h2>
              <div className="flex gap-4 text-sm">
                <span className="text-muted-foreground">
                  Invested: <span className="font-bold">${finishedTotals.invested.toLocaleString()}</span>
                </span>
                <span className="text-muted-foreground">
                  Final Value: <span className="font-bold">${finishedTotals.final_value.toLocaleString()}</span>
                </span>
                <span className={finishedTotals.realized_pnl >= 0 ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                  PnL: {finishedTotals.realized_pnl >= 0 ? "+" : ""}${finishedTotals.realized_pnl.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Best and Worst Trade Badges */}
            <div className="flex gap-3 mb-3">
              <div className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
                <Star className="h-4 w-4 text-green-600 dark:text-green-400 fill-current" />
                <span className="text-sm text-muted-foreground">Best Trade:</span>
                <Link href={`/analysis/market/${bestTrade.market_id}`}>
                  <Badge variant="outline" className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700 hover:bg-green-200 dark:hover:bg-green-900/50 cursor-pointer transition-colors">
                    {bestTrade.market_title}
                  </Badge>
                </Link>
                <span className="text-sm font-bold text-green-600 dark:text-green-400">
                  +${bestTrade.realized_pnl.toLocaleString()} ({bestTrade.realized_pnl_pct.toFixed(1)}%)
                </span>
              </div>
              <div className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800">
                <Star className="h-4 w-4 text-red-600 dark:text-red-400 fill-current" />
                <span className="text-sm text-muted-foreground">Worst Trade:</span>
                <Link href={`/analysis/market/${worstTrade.market_id}`}>
                  <Badge variant="outline" className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700 hover:bg-red-200 dark:hover:bg-red-900/50 cursor-pointer transition-colors">
                    {worstTrade.market_title}
                  </Badge>
                </Link>
                <span className="text-sm font-bold text-red-600 dark:text-red-400">
                  ${worstTrade.realized_pnl.toLocaleString()} ({worstTrade.realized_pnl_pct.toFixed(1)}%)
                </span>
              </div>
            </div>

            <div className="border rounded-lg overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Market</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Shares</TableHead>
                    <TableHead>Entry Price</TableHead>
                    <TableHead>Exit Price</TableHead>
                    <TableHead>Invested</TableHead>
                    <TableHead>Final Value</TableHead>
                    <TableHead>PnL</TableHead>
                    <TableHead>ROI</TableHead>
                    <TableHead>Closed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {finishedBets.map((bet) => (
                    <TableRow key={bet.position_id}>
                      <TableCell className="max-w-[250px]">
                        <div className="flex items-center gap-1">
                          {bet === bestTrade && (
                            <Star className="h-3 w-3 text-green-600 dark:text-green-400 fill-current flex-shrink-0" />
                          )}
                          {bet === worstTrade && (
                            <Star className="h-3 w-3 text-red-600 dark:text-red-400 fill-current flex-shrink-0" />
                          )}
                          <Link
                            href={`/analysis/market/${bet.market_id}`}
                            className="font-medium text-blue-600 hover:underline cursor-pointer truncate"
                          >
                            {bet.market_title}
                          </Link>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{bet.category}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={bet.side === "YES" ? "default" : "destructive"}>
                          {bet.side}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={bet.market_outcome === bet.side ? "default" : "destructive"}>
                          {bet.market_outcome}
                        </Badge>
                      </TableCell>
                      <TableCell>{bet.shares.toLocaleString()}</TableCell>
                      <TableCell>{(bet.avg_entry_price * 100).toFixed(1)}¢</TableCell>
                      <TableCell>{(bet.exit_price * 100).toFixed(1)}¢</TableCell>
                      <TableCell>${bet.invested.toLocaleString()}</TableCell>
                      <TableCell>${bet.final_value.toLocaleString()}</TableCell>
                      <TableCell className={bet.realized_pnl >= 0 ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                        {bet.realized_pnl >= 0 ? "+" : ""}${bet.realized_pnl.toLocaleString()} ({bet.realized_pnl_pct.toFixed(2)}%)
                      </TableCell>
                      <TableCell className={bet.roi >= 0 ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                        {bet.roi >= 0 ? "+" : ""}{bet.roi.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(bet.closed_date).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Finished Trades Scatter Chart */}
          <div className="border rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-4">Finished Trades: Buy vs Sell Price</h2>
            <div className="h-[400px]">
              <ReactECharts
                option={{
                  tooltip: {
                    trigger: 'item',
                    formatter: (params: any) => {
                      const bet = finishedBets[params.dataIndex];
                      return `
                        <div style="padding: 8px;">
                          <strong>${bet.market_title.substring(0, 50)}...</strong><br/>
                          Entry: <strong>${(bet.avg_entry_price * 100).toFixed(1)}¢</strong><br/>
                          Exit: <strong>${(bet.exit_price * 100).toFixed(1)}¢</strong><br/>
                          PnL: <strong style="color: ${bet.realized_pnl >= 0 ? '#16a34a' : '#dc2626'}">
                            ${bet.realized_pnl >= 0 ? '+' : ''}$${bet.realized_pnl.toLocaleString()}
                          </strong>
                        </div>
                      `;
                    },
                  },
                  xAxis: {
                    type: 'value',
                    name: 'Buy Price',
                    min: 0,
                    max: 1,
                    axisLabel: {
                      formatter: (value: number) => `${(value * 100).toFixed(0)}¢`,
                    },
                  },
                  yAxis: {
                    type: 'value',
                    name: 'Sell Price',
                    min: 0,
                    max: 1,
                    axisLabel: {
                      formatter: (value: number) => `${(value * 100).toFixed(0)}¢`,
                    },
                  },
                  series: [
                    {
                      name: 'Break-even line',
                      type: 'line',
                      data: [[0, 0], [1, 1]],
                      lineStyle: {
                        color: '#9ca3af',
                        type: 'dashed',
                        width: 2,
                      },
                      symbol: 'none',
                      z: 0,
                    },
                    {
                      name: 'Trades',
                      type: 'scatter',
                      data: finishedBets.map((bet) => [
                        bet.avg_entry_price,
                        bet.exit_price,
                      ]),
                      symbolSize: (data: number[], params: any) => {
                        const bet = finishedBets[params.dataIndex];
                        return Math.min(Math.max(bet.invested / 500, 8), 30);
                      },
                      itemStyle: {
                        color: (params: any) => {
                          const bet = finishedBets[params.dataIndex];
                          return bet.realized_pnl >= 0 ? '#16a34a' : '#dc2626';
                        },
                        opacity: 0.7,
                      },
                      z: 1,
                    },
                  ],
                }}
                style={{ height: '100%', width: '100%' }}
                opts={{ renderer: 'canvas' }}
              />
            </div>
            <div className="flex gap-6 text-sm mt-4 justify-center">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#16a34a' }} />
                <span>Profitable</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#dc2626' }} />
                <span>Loss</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-gray-400" />
                <span className="text-xs">Small</span>
                <div className="w-4 h-4 rounded-full bg-gray-400" />
                <span className="text-xs">Large Position</span>
              </div>
            </div>
          </div>

          {/* ROI Histogram */}
          <div className="border rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-4">ROI Distribution (Weighted by Investment)</h2>
            <div className="h-[350px]">
              <ReactECharts
                option={{
                  tooltip: {
                    trigger: 'axis',
                    axisPointer: {
                      type: 'shadow',
                    },
                    formatter: (params: any) => {
                      const data = params[0];
                      return `
                        <div style="padding: 8px;">
                          <strong>ROI: ${data.name}</strong><br/>
                          Investment: <strong>$${data.value.toLocaleString()}</strong>
                        </div>
                      `;
                    },
                  },
                  xAxis: {
                    type: 'category',
                    data: [
                      '< -75%',
                      '-75 to -50%',
                      '-50 to -25%',
                      '-25 to 0%',
                      '0 to 25%',
                      '25 to 50%',
                      '50 to 75%',
                      '75 to 100%',
                      '> 100%',
                    ],
                    axisLabel: {
                      rotate: 45,
                      fontSize: 10,
                    },
                  },
                  yAxis: {
                    type: 'value',
                    name: 'Investment ($)',
                    axisLabel: {
                      formatter: (value: number) => `$${(value / 1000).toFixed(0)}k`,
                    },
                  },
                  series: [
                    {
                      type: 'bar',
                      data: (() => {
                        const bins = [0, 0, 0, 0, 0, 0, 0, 0, 0];
                        finishedBets.forEach((bet) => {
                          const roi = bet.roi;
                          if (roi < -75) bins[0] += bet.invested;
                          else if (roi < -50) bins[1] += bet.invested;
                          else if (roi < -25) bins[2] += bet.invested;
                          else if (roi < 0) bins[3] += bet.invested;
                          else if (roi < 25) bins[4] += bet.invested;
                          else if (roi < 50) bins[5] += bet.invested;
                          else if (roi < 75) bins[6] += bet.invested;
                          else if (roi < 100) bins[7] += bet.invested;
                          else bins[8] += bet.invested;
                        });
                        return bins;
                      })(),
                      itemStyle: {
                        color: (params: any) => {
                          const index = params.dataIndex;
                          if (index < 4) return '#dc2626'; // Red for losses
                          if (index === 4) return '#f59e0b'; // Orange for small gains
                          return '#16a34a'; // Green for good gains
                        },
                      },
                    },
                  ],
                }}
                style={{ height: '100%', width: '100%' }}
                opts={{ renderer: 'canvas' }}
              />
            </div>
          </div>
        </div>

        {/* Analytics */}
        <div className="space-y-4">
          {/* Market Distribution Chart */}
          <div className="border rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-4">Market Category Distribution</h2>
            <div className="h-[300px]">
              <ReactECharts
                option={distributionChartOption}
                style={{ height: "100%", width: "100%" }}
                opts={{ renderer: "canvas" }}
              />
            </div>
          </div>

          {/* Trading Bubble Chart */}
          <div className="border rounded-lg p-4">
            <TradingBubbleChart finishedBets={finishedBets} />
          </div>

          {/* Trading Calendar Heatmap */}
          <div className="border rounded-lg p-4">
            <TradingCalendarHeatmap finishedBets={finishedBets} />
          </div>

          {/* Category Breakdown Table */}
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Trades</TableHead>
                  <TableHead>Volume</TableHead>
                  <TableHead>PnL</TableHead>
                  <TableHead>Win Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {marketDistribution.map((dist) => (
                  <TableRow key={dist.category}>
                    <TableCell className="font-medium">{dist.category}</TableCell>
                    <TableCell>{dist.trades}</TableCell>
                    <TableCell>${dist.volume.toLocaleString()}</TableCell>
                    <TableCell className={dist.pnl >= 0 ? "text-green-600 font-bold" : "text-red-600 font-bold"}>
                      ${dist.pnl.toLocaleString()}
                    </TableCell>
                    <TableCell>{(dist.win_rate * 100).toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Category PnL Donuts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Profit Breakdown */}
            <div className="border rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-4">Profit Breakdown by Category</h2>
              <div className="h-[300px]">
                <ReactECharts
                  option={{
                    tooltip: {
                      trigger: 'item',
                      formatter: (params: any) => {
                        return `
                          <div style="padding: 8px;">
                            <strong>${params.name}</strong><br/>
                            Profit: <strong style="color: #16a34a;">$${params.value.toLocaleString()}</strong><br/>
                            Percentage: <strong>${params.percent.toFixed(1)}%</strong>
                          </div>
                        `;
                      },
                    },
                    series: [
                      {
                        name: 'Profit',
                        type: 'pie',
                        radius: ['40%', '70%'],
                        avoidLabelOverlap: false,
                        label: {
                          show: true,
                          position: 'outside',
                          formatter: '{b}: ${c}',
                          fontSize: 10,
                        },
                        data: categoryStats
                          .filter(cat => cat.pnl > 0)
                          .map(cat => ({
                            name: cat.category,
                            value: cat.pnl,
                          })),
                        itemStyle: {
                          color: (params: any) => {
                            const colors = ['#16a34a', '#22c55e', '#4ade80', '#86efac', '#bbf7d0'];
                            return colors[params.dataIndex % colors.length];
                          },
                        },
                      },
                    ],
                  }}
                  style={{ height: '100%', width: '100%' }}
                  opts={{ renderer: 'canvas' }}
                />
              </div>
            </div>

            {/* Loss Breakdown */}
            <div className="border rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-4">Loss Breakdown by Category</h2>
              <div className="h-[300px]">
                <ReactECharts
                  option={{
                    tooltip: {
                      trigger: 'item',
                      formatter: (params: any) => {
                        return `
                          <div style="padding: 8px;">
                            <strong>${params.name}</strong><br/>
                            Loss: <strong style="color: #dc2626;">$${Math.abs(params.value).toLocaleString()}</strong><br/>
                            Percentage: <strong>${params.percent.toFixed(1)}%</strong>
                          </div>
                        `;
                      },
                    },
                    series: [
                      {
                        name: 'Loss',
                        type: 'pie',
                        radius: ['40%', '70%'],
                        avoidLabelOverlap: false,
                        label: {
                          show: true,
                          position: 'outside',
                          formatter: (params: any) => `${params.name}: $${Math.abs(params.value)}`,
                          fontSize: 10,
                        },
                        data: categoryStats
                          .filter(cat => cat.pnl < 0)
                          .map(cat => ({
                            name: cat.category,
                            value: Math.abs(cat.pnl),
                          })),
                        itemStyle: {
                          color: (params: any) => {
                            const colors = ['#dc2626', '#ef4444', '#f87171', '#fca5a5', '#fecaca'];
                            return colors[params.dataIndex % colors.length];
                          },
                        },
                      },
                    ],
                  }}
                  style={{ height: '100%', width: '100%' }}
                  opts={{ renderer: 'canvas' }}
                />
              </div>
            </div>
          </div>

          {/* Radar Charts */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Most Traded Categories */}
            <div className="border rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-4">Most Traded Categories</h2>
              <div className="h-[280px]">
                <ReactECharts
                  option={{
                    tooltip: {
                      trigger: 'item',
                    },
                    radar: {
                      indicator: categoryStats.map(cat => ({
                        name: cat.category,
                        max: Math.max(...categoryStats.map(c => c.trades)),
                      })),
                      radius: '60%',
                    },
                    series: [
                      {
                        type: 'radar',
                        data: [
                          {
                            value: categoryStats.map(cat => cat.trades),
                            name: 'Trades',
                            areaStyle: {
                              color: 'rgba(59, 130, 246, 0.3)',
                            },
                            lineStyle: {
                              color: '#3b82f6',
                            },
                            itemStyle: {
                              color: '#3b82f6',
                            },
                          },
                        ],
                      },
                    ],
                  }}
                  style={{ height: '100%', width: '100%' }}
                  opts={{ renderer: 'canvas' }}
                />
              </div>
            </div>

            {/* Smart Score by Category */}
            <div className="border rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-4">Smart Score by Category</h2>
              <div className="h-[280px]">
                <ReactECharts
                  option={{
                    tooltip: {
                      trigger: 'item',
                    },
                    radar: {
                      indicator: categoryStats.map(cat => ({
                        name: cat.category,
                        max: 100,
                      })),
                      radius: '60%',
                    },
                    series: [
                      {
                        type: 'radar',
                        data: [
                          {
                            value: categoryStats.map(cat => cat.smart_score),
                            name: 'Smart Score',
                            areaStyle: {
                              color: 'rgba(168, 85, 247, 0.3)',
                            },
                            lineStyle: {
                              color: '#a855f7',
                            },
                            itemStyle: {
                              color: '#a855f7',
                            },
                          },
                        ],
                      },
                    ],
                  }}
                  style={{ height: '100%', width: '100%' }}
                  opts={{ renderer: 'canvas' }}
                />
              </div>
            </div>

            {/* Win Rate by Category */}
            <div className="border rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-4">Win Rate by Category</h2>
              <div className="h-[280px]">
                <ReactECharts
                  option={{
                    tooltip: {
                      trigger: 'item',
                    },
                    radar: {
                      indicator: categoryStats.map(cat => ({
                        name: cat.category,
                        max: 1,
                      })),
                      radius: '60%',
                    },
                    series: [
                      {
                        type: 'radar',
                        data: [
                          {
                            value: categoryStats.map(cat => cat.win_rate),
                            name: 'Win Rate',
                            areaStyle: {
                              color: 'rgba(34, 197, 94, 0.3)',
                            },
                            lineStyle: {
                              color: '#22c55e',
                            },
                            itemStyle: {
                              color: '#22c55e',
                            },
                          },
                        ],
                      },
                    ],
                  }}
                  style={{ height: '100%', width: '100%' }}
                  opts={{ renderer: 'canvas' }}
                />
              </div>
            </div>
          </div>

          {/* Entry Preference Bar Chart */}
          <div className="border rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-4">Entry Preference (Price Range Analysis)</h2>
            <div className="h-[350px]">
              <ReactECharts
                option={{
                  tooltip: {
                    trigger: 'axis',
                    axisPointer: {
                      type: 'shadow',
                    },
                    formatter: (params: any) => {
                      const data = params[0];
                      const bucket = entryBuckets[data.dataIndex];
                      return `
                        <div style="padding: 8px;">
                          <strong>Price Range: ${bucket.bucket}</strong><br/>
                          Invested: <strong>$${bucket.invested_usd.toLocaleString()}</strong><br/>
                          Trades: <strong>${bucket.trade_count}</strong>
                        </div>
                      `;
                    },
                  },
                  xAxis: {
                    type: 'category',
                    data: entryBuckets.map(b => b.bucket),
                    name: 'Entry Price Range',
                    axisLabel: {
                      rotate: 45,
                      fontSize: 10,
                    },
                  },
                  yAxis: {
                    type: 'value',
                    name: 'Investment ($)',
                    axisLabel: {
                      formatter: (value: number) => `$${(value / 1000).toFixed(0)}k`,
                    },
                  },
                  series: [
                    {
                      type: 'bar',
                      data: entryBuckets.map(b => b.invested_usd),
                      itemStyle: {
                        color: (params: any) => {
                          const gradient = [
                            '#dc2626', '#ef4444', '#f87171', '#fb923c', '#fbbf24',
                            '#a3e635', '#4ade80', '#22c55e', '#16a34a', '#15803d',
                          ];
                          return gradient[params.dataIndex];
                        },
                      },
                    },
                  ],
                }}
                style={{ height: '100%', width: '100%' }}
                opts={{ renderer: 'canvas' }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              Shows where this trader prefers to enter positions. Higher bars indicate more capital deployed at those price levels.
            </p>
          </div>
        </div>

        {/* Compare */}
        <div className="space-y-4">
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead>Your Value</TableHead>
                  <TableHead>Platform Avg</TableHead>
                  <TableHead>Top 10% Avg</TableHead>
                  <TableHead>Percentile</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparisons.map((comp) => (
                  <TableRow key={comp.metric}>
                    <TableCell className="font-medium">{comp.metric}</TableCell>
                    <TableCell className="font-bold text-blue-600">
                      {comp.metric.includes("%") || comp.metric === "Win Rate"
                        ? `${comp.wallet_value.toFixed(1)}%`
                        : comp.wallet_value.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {comp.metric.includes("%") || comp.metric === "Win Rate"
                        ? `${comp.platform_avg.toFixed(1)}%`
                        : comp.platform_avg.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {comp.metric.includes("%") || comp.metric === "Win Rate"
                        ? `${comp.top_10_pct_avg.toFixed(1)}%`
                        : comp.top_10_pct_avg.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden max-w-[100px]">
                          <div
                            className={`h-full ${comp.percentile >= 75 ? "bg-green-600" : comp.percentile >= 50 ? "bg-blue-600" : "bg-orange-600"}`}
                            style={{ width: `${comp.percentile}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium">{comp.percentile}th</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="border rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-3">Performance Summary</h3>
            <p className="text-sm text-muted-foreground mb-4">
              This wallet ranks in the <strong>top 22%</strong> of all traders on the platform.
              Their win rate of <strong>62.8%</strong> is significantly above the platform average of 52.3%.
              With a WIS score of <strong>85</strong>, they are considered an <strong>Elite</strong> trader.
            </p>
            <div className="flex gap-2">
              <Badge className="bg-purple-600">Elite Trader</Badge>
              <Badge className="bg-green-600">Above Average Returns</Badge>
              <Badge className="bg-blue-600">High Activity</Badge>
            </div>
          </div>
        </div>
    </div>
  );
}
