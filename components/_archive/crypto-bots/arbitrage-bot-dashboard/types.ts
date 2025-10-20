export type ArbitrageOpportunity = {
  id: string;
  pair: string;
  buyExchange: string;
  sellExchange: string;
  spread: number;
  volume: number;
  profit: number;
  status: "active" | "completed" | "failed";
  timestamp: Date;
  executionTime?: number;
};

export type Exchange = {
  id: string;
  name: string;
  logo: string;
  status: "connected" | "disconnected" | "error";
  apiKeyConfigured: boolean;
};

export type ArbitrageBot = {
  id: string;
  name: string;
  status: "active" | "paused" | "stopped";
  description?: string;
  settings?: any;
  performance?: any;
  recentTrades?: any;
  alerts?: any;
  exchanges: string[];
  pairs: string[];
  minSpread: number;
  maxVolume: number;
  profitThreshold: number;
  createdAt: Date;
  lastActive: Date;
  totalTrades: number;
  successRate: number;
  totalProfit: number;
};

export type ArbitrageStats = {
  totalProfit: number;
  totalTrades: number;
  successRate: number;
  avgExecutionTime: number;
  bestPair: string;
  bestExchangePair: string;
  largestSpread: number;
};

export type GlobalBotStatus = "active" | "paused";
