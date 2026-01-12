/**
 * PnL Engine V7 - Polymarket API Direct
 *
 * This engine fetches PnL directly from Polymarket's user-pnl-api which is the
 * authoritative source for the UI values. This provides 100% accuracy with UI.
 *
 * For wallets not in Polymarket's system, we fall back to V6 calculation.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV6 } from './pnlEngineV6';

export interface PnLResultV7 {
  wallet: string;
  totalPnl: number;
  source: 'polymarket-api' | 'v6-fallback';
  timeSeries?: Array<{ timestamp: number; pnl: number }>;
}

/**
 * Fetch PnL from Polymarket's user-pnl-api
 * Returns time-series data with the latest value being the current PnL
 */
async function fetchPolymarketPnL(wallet: string): Promise<{ pnl: number; timeSeries: Array<{ timestamp: number; pnl: number }> } | null> {
  const url = `https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet.toLowerCase()}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = (await res.json()) as Array<{ t: number; p: number }>;
    if (!data || data.length === 0) return null;

    const timeSeries = data.map(d => ({ timestamp: d.t, pnl: d.p }));
    const latestPnl = data[data.length - 1].p;

    return { pnl: latestPnl, timeSeries };
  } catch {
    return null;
  }
}

/**
 * Get wallet PnL using Polymarket API as primary source, V6 as fallback
 */
export async function getWalletPnLV7(wallet: string): Promise<PnLResultV7> {
  const w = wallet.toLowerCase();

  // Try Polymarket API first
  const apiResult = await fetchPolymarketPnL(w);
  if (apiResult) {
    return {
      wallet: w,
      totalPnl: Math.round(apiResult.pnl * 100) / 100,
      source: 'polymarket-api',
      timeSeries: apiResult.timeSeries,
    };
  }

  // Fall back to V6 calculation
  const v6Result = await getWalletPnLV6(w);
  return {
    wallet: w,
    totalPnl: v6Result.totalPnl,
    source: 'v6-fallback',
  };
}

/**
 * Get PnL for multiple wallets in parallel
 */
export async function getMultipleWalletsPnLV7(wallets: string[]): Promise<PnLResultV7[]> {
  return Promise.all(wallets.map(w => getWalletPnLV7(w)));
}
