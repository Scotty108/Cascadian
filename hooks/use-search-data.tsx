"use client";

import { useEffect, useState } from "react";

export interface SearchItem {
  id: string;
  title: string;
  description?: string;
  category: string;
  href: string;
  symbol?: string;
  price?: string;
  change?: string;
  status?: string;
}

export interface SearchResults {
  markets: SearchItem[];
  bots: SearchItem[];
  pages: SearchItem[];
}

// Mock data - in a real app, this would come from an API
const mockMarkets: SearchItem[] = [
  {
    id: "btc-usd",
    title: "Bitcoin",
    symbol: "BTC/USD",
    price: "68,245.32",
    change: "+2.4%",
    category: "Market",
    href: "/trading?pair=BTC-USD",
  },
  {
    id: "eth-usd",
    title: "Ethereum",
    symbol: "ETH/USD",
    price: "3,892.17",
    change: "-0.8%",
    category: "Market",
    href: "/trading?pair=ETH-USD",
  },
  {
    id: "sol-usd",
    title: "Solana",
    symbol: "SOL/USD",
    price: "198.45",
    change: "+5.2%",
    category: "Market",
    href: "/trading?pair=SOL-USD",
  },
  {
    id: "ada-usd",
    title: "Cardano",
    symbol: "ADA/USD",
    price: "1.23",
    change: "+1.8%",
    category: "Market",
    href: "/trading?pair=ADA-USD",
  },
  {
    id: "dot-usd",
    title: "Polkadot",
    symbol: "DOT/USD",
    price: "8.45",
    change: "-2.1%",
    category: "Market",
    href: "/trading?pair=DOT-USD",
  },
];

const mockBots: SearchItem[] = [
  {
    id: "ai-bot-1",
    title: "AI Trading Bot",
    description: "Advanced AI-powered trading",
    status: "active",
    category: "Bot",
    href: "/ai-bot",
  },
  {
    id: "dca-bot-1",
    title: "DCA Bot",
    description: "Dollar-cost averaging strategy",
    status: "active",
    category: "Bot",
    href: "/dca-bot",
  },
  {
    id: "arbitrage-bot-1",
    title: "Arbitrage Bot",
    description: "Cross-exchange arbitrage",
    status: "inactive",
    category: "Bot",
    href: "/arbitrage-bot",
  },
  {
    id: "signal-bot-1",
    title: "Signal Bot",
    description: "Trading signal automation",
    status: "active",
    category: "Bot",
    href: "/signal-bot",
  },
];

const mockPages: SearchItem[] = [
  {
    id: "trading",
    title: "Trading",
    description: "Advanced trading interface",
    category: "Page",
    href: "/trading",
  },
  {
    id: "portfolio",
    title: "Portfolio Tracker",
    description: "Track your investments",
    category: "Page",
    href: "/portfolio-tracker",
  },
  {
    id: "analytics",
    title: "My Analytics",
    description: "Performance analytics",
    category: "Page",
    href: "/my-analytics",
  },
  {
    id: "defi",
    title: "DeFi Center",
    description: "DeFi protocols and opportunities",
    category: "Page",
    href: "/defi-center/staking-pools",
  },
  {
    id: "pump-screener",
    title: "Pump Screener",
    description: "Find trending tokens",
    category: "Page",
    href: "/pump-screener",
  },
  {
    id: "strategies",
    title: "Strategies Marketplace",
    description: "Browse trading strategies",
    category: "Page",
    href: "/strategies-marketplace",
  },
  {
    id: "wallets",
    title: "Wallets",
    description: "Manage your wallets",
    category: "Page",
    href: "/wallets",
  },
  {
    id: "settings",
    title: "Settings",
    description: "Account and app settings",
    category: "Page",
    href: "/settings",
  },
];

export function useSearchData(query: string) {
  const [searchResults, setSearchResults] = useState<SearchResults>({
    markets: [],
    bots: [],
    pages: [],
  });
  const [recentSearches, setRecentSearches] = useState<SearchItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load recent searches from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("recent-searches");
    if (saved) {
      try {
        setRecentSearches(JSON.parse(saved));
      } catch (error) {
        console.error("Failed to parse recent searches:", error);
      }
    }
  }, []);

  // Search functionality
  useEffect(() => {
    if (!query.trim()) {
      setSearchResults({ markets: [], bots: [], pages: [] });
      return;
    }

    setIsLoading(true);

    // Simulate API delay
    const timeoutId = setTimeout(() => {
      const searchTerm = query.toLowerCase();

      const filteredMarkets = mockMarkets.filter((market) => market.title.toLowerCase().includes(searchTerm) || market.symbol?.toLowerCase().includes(searchTerm));

      const filteredBots = mockBots.filter((bot) => bot.title.toLowerCase().includes(searchTerm) || bot.description?.toLowerCase().includes(searchTerm));

      const filteredPages = mockPages.filter((page) => page.title.toLowerCase().includes(searchTerm) || page.description?.toLowerCase().includes(searchTerm));

      setSearchResults({
        markets: filteredMarkets,
        bots: filteredBots,
        pages: filteredPages,
      });

      setIsLoading(false);
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [query]);

  const addRecentSearch = (item: SearchItem) => {
    const newRecentSearches = [item, ...recentSearches.filter((recent) => recent.id !== item.id)].slice(0, 5); // Keep only 5 recent searches

    setRecentSearches(newRecentSearches);
    localStorage.setItem("recent-searches", JSON.stringify(newRecentSearches));
  };

  return {
    searchResults,
    recentSearches,
    addRecentSearch,
    isLoading,
  };
}
