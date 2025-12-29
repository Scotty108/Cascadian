/**
 * Dome API Client Module
 *
 * Exports all Dome API functionality for market data and real-time streaming.
 */

// Market data client
export {
  domeMarketClient,
  listMarkets,
  getCandles,
  getMarketPrice,
  getTradeHistory,
  flattenCandles,
  calculateCandleStats,
  clearMarketCache,
  clearPriceCache,
  clearAllCaches,
} from './client';

// Types
export type {
  DomeMarket,
  DomePagination,
  DomeMarketsResponse,
  DomeMarketFilters,
  DomeCandlePrice,
  DomeCandleBidAsk,
  DomeCandle,
  DomeCandlesResponse,
  DomeMarketPrice,
  DomeOrder,
  DomeOrdersResponse,
  DomeTradeFilters,
  CandleInterval,
  DomeClientResult,
} from './client';

// WebSocket client
export {
  domeWsClient,
} from './wsClient';

export type {
  DomeWsStatus,
  DomeWsSubscription,
  DomeWsMessage,
  OrderHandler,
  StatusHandler,
  ErrorHandler,
} from './wsClient';
