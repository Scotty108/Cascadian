/**
 * Hook: useEventSmartSummary
 *
 * Aggregates smart money data across all markets in an event.
 * Calculates rankings based on smart money activity rather than crowd odds.
 */

import { useQueries, useQuery } from "@tanstack/react-query";
import { usePolymarketEventDetail } from "@/hooks/use-polymarket-event-detail";

export interface Market {
  id: string;
  question: string;
  description?: string;
  active: boolean;
  closed: boolean;
  outcomes: string[] | string;
  outcomePrices: string;
  clobTokenIds?: string;
  conditionId?: string;
  image?: string;
  slug?: string;
}

export interface DetectedSignal {
  signalId: string;
  winRate: number;
  expectedRoi: number;
  historicalTrades: number;
  confidence: "high" | "medium" | "low";
}

export interface SmartMarketData {
  id: string;
  conditionId: string;
  question: string;
  shortName: string;
  image?: string;
  crowdOdds: number;
  smartOdds: number | null;
  delta: number | null;
  signal: "BULLISH" | "BEARISH" | "NEUTRAL" | "PENDING";
  superforecasterCount: number;
  totalInvested: number;
  smartWalletCount: number;
  hasSmartMoneyData: boolean;
  conviction: {
    score: number;
    level: string;
  } | null;
  pnlStatus: {
    status: "winning" | "losing" | "breakeven";
    unrealizedPnl: number;
    roi: number;
  } | null;
  detectedSignal: DetectedSignal | null;
  flow24h: number;
  clobTokenIds?: string; // For OHLC chart data
}

export interface SmartPrediction {
  topOutcome: SmartMarketData | null;
  rankings: SmartMarketData[];
}

export interface EventSmartSummary {
  event: {
    title: string;
    slug: string;
    description: string;
    category: string;
    totalVolume: number;
    marketCount: number;
    closesAt: string;
    image?: string;
  };
  smartPrediction: SmartPrediction;
  markets: SmartMarketData[];
  isLoading: boolean;
  error: Error | null;
}

// Helper to extract short name from question
function getShortName(question: string): string {
  // Remove common patterns
  let name = question
    .replace(/^Will\s+/i, "")
    .replace(/\?$/g, "")
    .replace(/\s+win\s+the\s+\d{4}\s+.*$/i, "")
    .replace(/\s+be\s+the\s+\d{4}\s+.*$/i, "")
    .replace(/\s+in\s+\d{4}$/i, "")
    .replace(/\s+on\s+\w+\s+\d+\??$/i, "")
    .replace(/\s+by\s+market\s+cap$/i, "")
    .replace(/\s+by\s+end\s+of\s+\d{4}\??$/i, "");

  // Truncate if still too long
  if (name.length > 40) {
    name = name.slice(0, 37) + "...";
  }

  return name;
}

// Helper to parse crowd odds from market data
function parseCrowdOdds(market: Market): number {
  try {
    const prices = JSON.parse(market.outcomePrices || "[]");
    const yesPrice = typeof prices[0] === "string" ? parseFloat(prices[0]) : prices[0];
    return yesPrice || 0.5;
  } catch {
    return 0.5;
  }
}

// Helper to get condition ID
function getConditionId(market: Market): string {
  if (market.conditionId) {
    return market.conditionId.replace(/^0x/i, "").toLowerCase();
  }
  return "";
}

// Helper to determine signal from delta
function getSignal(delta: number | null): "BULLISH" | "BEARISH" | "NEUTRAL" | "PENDING" {
  if (delta === null) return "PENDING";
  if (delta > 0.05) return "BULLISH";
  if (delta < -0.05) return "BEARISH";
  return "NEUTRAL";
}

export function useEventSmartSummary(eventSlug: string): EventSmartSummary {
  // Fetch event detail
  const { event, isLoading: eventLoading, error: eventError } = usePolymarketEventDetail(eventSlug);

  // Extract markets from event
  const markets = (event?.markets || []) as Market[];

  // Fetch smart money breakdown for each market (batched)
  const breakdownQueries = useQueries({
    queries: markets.map((market) => {
      const conditionId = getConditionId(market);
      return {
        queryKey: ["smart-money-breakdown", conditionId],
        queryFn: async () => {
          if (!conditionId || conditionId.length !== 64) return null;

          const response = await fetch(`/api/markets/${conditionId}/smart-money-breakdown`);
          if (!response.ok) return null;

          const result = await response.json();
          return result.success ? result.data : null;
        },
        enabled: !!conditionId && conditionId.length === 64,
        staleTime: 60 * 1000, // 1 minute
        gcTime: 5 * 60 * 1000, // 5 minutes
      };
    }),
  });

  // Fetch WIO smart money data for each market (for superforecaster count)
  const wioQueries = useQueries({
    queries: markets.map((market) => {
      return {
        queryKey: ["wio-smart-money", market.id],
        queryFn: async () => {
          const response = await fetch(`/api/wio/markets/${market.id}/smart-money`);
          if (!response.ok) return null;

          const result = await response.json();
          return result.success ? result : null;
        },
        enabled: !!market.id,
        staleTime: 60 * 1000,
        gcTime: 5 * 60 * 1000,
      };
    }),
  });

  // Combine all data
  const isLoading =
    eventLoading ||
    breakdownQueries.some((q) => q.isLoading) ||
    wioQueries.some((q) => q.isLoading);

  // Build market data with smart money info
  const smartMarkets: SmartMarketData[] = markets.map((market, index) => {
    const breakdown = breakdownQueries[index]?.data;
    const wio = wioQueries[index]?.data;
    const crowdOdds = parseCrowdOdds(market);

    // Extract smart money data
    // API returns odds as percentage (0-100), normalize to decimal (0-1)
    const smartOddsRaw = breakdown?.summary?.smart_money_odds;
    const smartOdds = smartOddsRaw !== null && smartOddsRaw !== undefined
      ? smartOddsRaw / 100
      : null;
    const delta = smartOdds !== null ? smartOdds - crowdOdds : null;

    // Get superforecaster count from WIO
    const sfYes = wio?.superforecasters?.yes_count || 0;
    const sfNo = wio?.superforecasters?.no_count || 0;
    const superforecasterCount = sfYes + sfNo;

    // Get smart wallet count and total invested
    const smartWalletCount = breakdown?.summary?.smart_wallets || wio?.snapshot?.smart_wallet_count || 0;
    const totalInvested = breakdown?.summary?.smart_invested_usd || wio?.snapshot?.smart_holdings_usd || 0;

    return {
      id: market.id,
      conditionId: getConditionId(market),
      question: market.question,
      shortName: getShortName(market.question),
      image: market.image,
      crowdOdds,
      smartOdds,
      delta,
      signal: getSignal(delta),
      superforecasterCount,
      totalInvested,
      smartWalletCount,
      hasSmartMoneyData: smartOdds !== null,
      conviction: breakdown?.conviction
        ? {
            score: breakdown.conviction.score,
            level: breakdown.conviction.level,
          }
        : null,
      pnlStatus: breakdown?.pnl_status
        ? {
            status: breakdown.pnl_status.status,
            unrealizedPnl: breakdown.pnl_status.unrealized_pnl_usd,
            roi: breakdown.pnl_status.unrealized_roi_percent,
          }
        : null,
      detectedSignal: null, // Will be populated by signals API in future
      flow24h: wio?.snapshot?.flow_24h || 0,
      clobTokenIds: market.clobTokenIds,
    };
  });

  // Sort by smart money activity (total invested)
  const sortedByActivity = [...smartMarkets].sort((a, b) => {
    // Markets with smart money data first
    if (a.hasSmartMoneyData && !b.hasSmartMoneyData) return -1;
    if (!a.hasSmartMoneyData && b.hasSmartMoneyData) return 1;
    // Then by total invested
    return b.totalInvested - a.totalInvested;
  });

  // Rank by smart odds (highest first, but only those with data)
  const rankings = [...smartMarkets]
    .filter((m) => m.hasSmartMoneyData && m.smartOdds !== null)
    .sort((a, b) => (b.smartOdds || 0) - (a.smartOdds || 0))
    .map((m, idx) => ({ ...m, rank: idx + 1 }));

  // Top prediction
  const topOutcome = rankings.length > 0 ? rankings[0] : null;

  return {
    event: {
      title: event?.title || "",
      slug: event?.slug || eventSlug,
      description: event?.description || "",
      category: event?.category || "",
      totalVolume: event?.volume || 0,
      marketCount: markets.length,
      closesAt: event?.endDate || "",
      image: (event as any)?.image,
    },
    smartPrediction: {
      topOutcome,
      rankings,
    },
    markets: sortedByActivity,
    isLoading,
    error: eventError,
  };
}
