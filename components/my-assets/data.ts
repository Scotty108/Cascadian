import { BarChart3, CreditCard, DollarSign, Users } from "lucide-react";
import type { AssetData, KpiMetric, Transaction } from "./types";

export const portfolioData: AssetData[] = [
  {
    name: "Bitcoin (BTC)",
    value: 32550,
    percentage: 47.8,
    color: "#f7931a",
    symbol: "BTC",
    price: 42830,
    holdings: "0.76 BTC",
  },
  {
    name: "Ethereum (ETH)",
    value: 8324,
    percentage: 24.1,
    color: "#627eea",
    symbol: "ETH",
    price: 3890,
    holdings: "2.14 ETH",
  },
  {
    name: "Solana (SOL)",
    value: 3445,
    percentage: 10.1,
    color: "#9945ff",
    symbol: "SOL",
    price: 106,
    holdings: "32.5 SOL",
  },
  {
    name: "Binance Coin (BNB)",
    value: 3016,
    percentage: 8.8,
    color: "#f3ba2f",
    symbol: "BNB",
    price: 580,
    holdings: "5.2 BNB",
  },
  { name: "USDT", value: 2500, percentage: 7.3, color: "#26a17b", symbol: "USDT", price: 1, holdings: "2500 USDT" },
  { name: "Others", value: 896, percentage: 1.9, color: "#8884d8" },
];

export const topAssets: AssetData[] = [
  { name: "Bitcoin (BTC)", value: 42830, percentage: 32.5, change: 32.5, color: "#f7931a" },
  { name: "Ethereum (ETH)", value: 3890, percentage: 24.8, change: 24.8, color: "#627eea" },
  { name: "Solana (SOL)", value: 106, percentage: -5.2, change: -5.2, color: "#9945ff" },
  { name: "Binance Coin (BNB)", value: 580, percentage: 18.3, change: 18.3, color: "#f3ba2f" },
];

export const transactions: Transaction[] = [
  {
    type: "bought",
    asset: "Bitcoin",
    amount: "+0.25 BTC",
    date: "May 15, 2023",
    value: "$10,750",
  },
  {
    type: "sold",
    asset: "Ethereum",
    amount: "-1.5 ETH",
    date: "May 12, 2023",
    value: "$5,835",
  },
  {
    type: "bought",
    asset: "Solana",
    amount: "+15 SOL",
    date: "May 10, 2023",
    value: "$1,590",
  },
  {
    type: "bought",
    asset: "BNB",
    amount: "+2.5 BNB",
    date: "May 8, 2023",
    value: "$1,450",
  },
];

export const kpiMetrics: KpiMetric[] = [
  {
    title: "Total Assets",
    value: "$45,231.89",
    change: "+20.1% from last month",
    icon: DollarSign,
    isPositive: true,
  },
  {
    title: "Total Coins",
    value: "12",
    change: "+2 since last month",
    icon: Users,
    isPositive: true,
  },
  {
    title: "Total Profit",
    value: "+$12,234",
    change: "+19% from last month",
    icon: CreditCard,
    isPositive: true,
  },
  {
    title: "Portfolio Change",
    value: "+15.3%",
    change: "+2.5% since yesterday",
    icon: BarChart3,
    isPositive: true,
  },
];
