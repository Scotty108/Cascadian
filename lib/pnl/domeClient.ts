/**
 * ============================================================================
 * DOME API CLIENT - REALIZED PNL FETCHER
 * ============================================================================
 *
 * Minimal client for fetching realized PnL from Dome API.
 *
 * ENVIRONMENT VARIABLES:
 * - DOME_API_KEY: Required. Dome API bearer token.
 *
 * USAGE:
 *   import { fetchDomeRealizedPnL } from './lib/pnl/domeClient';
 *   const result = await fetchDomeRealizedPnL('0x...');
 *
 * Terminal: Claude 1
 * Date: 2025-12-07
 */

// ============================================================================
// Types
// ============================================================================

export interface DomeRealizedResult {
  wallet: string;
  realizedPnl: number | null;
  confidence: 'high' | 'low' | 'none';
  isPlaceholder: boolean;
  raw?: any;
  error?: string;
}

// ============================================================================
// In-Memory Cache
// ============================================================================

const cache = new Map<string, DomeRealizedResult>();

// ============================================================================
// Endpoint Discovery
// ============================================================================

const BASE_URL = 'https://api.domeapi.io/v1';

const CANDIDATE_ENDPOINTS = [
  (wallet: string) => `/polymarket/wallet/pnl/${wallet}?granularity=all`,
];

let discoveredEndpoint: ((wallet: string) => string) | null = null;

// ============================================================================
// Fetch Implementation
// ============================================================================

export async function fetchDomeRealizedPnL(wallet: string): Promise<DomeRealizedResult> {
  const normalizedWallet = wallet.toLowerCase();

  // Check cache
  if (cache.has(normalizedWallet)) {
    return cache.get(normalizedWallet)!;
  }

  // Ensure API key is set
  const apiKey = process.env.DOME_API_KEY;
  if (!apiKey) {
    const result: DomeRealizedResult = {
      wallet: normalizedWallet,
      realizedPnl: null,
      confidence: 'none',
      isPlaceholder: false,
      error: 'DOME_API_KEY environment variable not set',
    };
    cache.set(normalizedWallet, result);
    return result;
  }

  // If we already discovered the endpoint, use it
  if (discoveredEndpoint) {
    return await fetchWithEndpoint(normalizedWallet, discoveredEndpoint, apiKey);
  }

  // Try each candidate endpoint until one works
  for (const endpointFn of CANDIDATE_ENDPOINTS) {
    try {
      const result = await fetchWithEndpoint(normalizedWallet, endpointFn, apiKey);
      if (!result.error) {
        // Success! Cache the endpoint
        discoveredEndpoint = endpointFn;
        console.log(`✅ Discovered working Dome endpoint: ${endpointFn(normalizedWallet)}`);
        return result;
      } else {
        console.log(`   ⚠️  Endpoint ${endpointFn(normalizedWallet)} failed: ${result.error}`);
      }
    } catch (error: any) {
      console.log(`   ⚠️  Endpoint ${endpointFn(normalizedWallet)} threw error: ${error.message}`);
      // Try next endpoint
      continue;
    }
  }

  // All endpoints failed
  const result: DomeRealizedResult = {
    wallet: normalizedWallet,
    realizedPnl: null,
    confidence: 'none',
    isPlaceholder: false,
    error: 'All candidate Dome endpoints failed',
  };
  cache.set(normalizedWallet, result);
  return result;
}

async function fetchWithEndpoint(
  wallet: string,
  endpointFn: (wallet: string) => string,
  apiKey: string
): Promise<DomeRealizedResult> {
  const endpoint = endpointFn(wallet);
  const url = `${BASE_URL}${endpoint}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const result: DomeRealizedResult = {
        wallet,
        realizedPnl: null,
        confidence: 'none',
        isPlaceholder: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
      cache.set(wallet, result);
      return result;
    }

    const data = await response.json();

    // Check if this is a placeholder response
    const isPlaceholder = isPlaceholderDomePnl(data);

    // Try to extract realized PnL from response
    const realizedPnl = extractRealizedPnL(data);

    // Assess confidence level
    const confidence = assessConfidence(data, realizedPnl, isPlaceholder);

    if (isPlaceholder) {
      console.warn(`⚠️  Dome returned placeholder data for ${wallet} (no processing yet)`);
      const result: DomeRealizedResult = {
        wallet,
        realizedPnl: null,
        confidence: 'none',
        isPlaceholder: true,
        raw: data,
        error: 'Placeholder response (Dome has not processed this wallet)',
      };
      cache.set(wallet, result);
      return result;
    }

    if (realizedPnl === null) {
      console.warn(`⚠️  Could not extract realized PnL from Dome response for ${wallet}`);
      const result: DomeRealizedResult = {
        wallet,
        realizedPnl: null,
        confidence: 'none',
        isPlaceholder: false,
        raw: data,
        error: 'Could not extract realized PnL from response',
      };
      cache.set(wallet, result);
      return result;
    }

    const result: DomeRealizedResult = {
      wallet,
      realizedPnl,
      confidence,
      isPlaceholder: false,
      raw: data,
    };
    cache.set(wallet, result);
    return result;
  } catch (error: any) {
    const result: DomeRealizedResult = {
      wallet,
      realizedPnl: null,
      confidence: 'none',
      isPlaceholder: false,
      error: error.message,
    };
    cache.set(wallet, result);
    return result;
  }
}

// ============================================================================
// Placeholder Detection
// ============================================================================

const PLACEHOLDER_START_TIME = 1609459200; // 2021-01-01 00:00:00 UTC

/**
 * Detects if Dome response is a placeholder (no actual data processed).
 *
 * Criteria:
 * - start_time == 2021-01-01 (1609459200) - sentinel value
 * - AND pnl_to_date == 0
 *
 * This indicates Dome hasn't processed this wallet's trades yet.
 */
function isPlaceholderDomePnl(data: any): boolean {
  if (!data) return true;

  const startTime = data.start_time;
  const pnlOverTime = data.pnl_over_time;

  // Check for placeholder start time
  if (startTime === PLACEHOLDER_START_TIME) {
    // Check if pnl_to_date is 0
    if (Array.isArray(pnlOverTime) && pnlOverTime.length > 0) {
      const latest = pnlOverTime[pnlOverTime.length - 1];
      if (latest?.pnl_to_date === 0) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Determines confidence level based on data quality.
 *
 * - 'high': Valid data with non-zero PnL
 * - 'low': Valid data but zero PnL (could be legitimate or edge case)
 * - 'none': Placeholder data (no processing by Dome)
 */
function assessConfidence(data: any, realizedPnl: number | null, isPlaceholder: boolean): 'high' | 'low' | 'none' {
  if (isPlaceholder) return 'none';
  if (realizedPnl === null) return 'none';
  if (realizedPnl === 0) return 'low';
  return 'high';
}

// ============================================================================
// PnL Extraction
// ============================================================================

function extractRealizedPnL(data: any): number | null {
  // Dome API format: { pnl_over_time: [{ timestamp, pnl_to_date }] }
  // The last entry in pnl_over_time contains the most recent realized PnL
  if (Array.isArray(data?.pnl_over_time) && data.pnl_over_time.length > 0) {
    const latest = data.pnl_over_time[data.pnl_over_time.length - 1];
    if (typeof latest?.pnl_to_date === 'number') {
      return latest.pnl_to_date;
    }
  }

  // Fallback: try other common field names
  const candidates = [
    data?.realizedPnl,
    data?.realized_pnl,
    data?.pnl?.realized,
    data?.pnl?.realizedPnl,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'number') {
      return candidate;
    }
    if (typeof candidate === 'string') {
      const parsed = parseFloat(candidate);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

// ============================================================================
// Cache Management
// ============================================================================

export function clearDomeCache(): void {
  cache.clear();
}

export function getDomeCacheSize(): number {
  return cache.size;
}
