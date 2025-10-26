/**
 * High Conviction Wallets Integration
 *
 * Exposes audited wallet P&L to strategy executor.
 * Source of truth: audited_wallet_pnl_extended.json (548 wallets)
 *
 * Governance rules:
 * - Only wallets with coverage ≥2% are considered "high conviction"
 * - This is the authoritative "signal wallets" list for strategies
 * - Never uses legacy pnl_net or contaminated data
 */

import { getTopWallets, getWalletPnL, type TopWallet } from '@/lib/data/wallet-pnl-feed'

export interface HighConvictionWallet {
  wallet: string
  realizedPnlUsd: number
  coveragePct: number
  rank: number
}

/**
 * Get high conviction wallets for strategy use
 *
 * Returns wallets that pass coverage threshold (≥2%) sorted by realized P&L.
 * This is the official "who are my signal wallets right now" function.
 *
 * @param minCoveragePct - Minimum coverage % (default: 2%)
 * @param limit - Maximum wallets to return (default: 100)
 * @returns Array of high conviction wallets with P&L and coverage
 *
 * Usage in executor:
 * ```
 * const signalWallets = getHighConvictionWallets()
 * const isHighConviction = signalWallets.some(w => w.wallet === tradeWallet)
 * ```
 */
export function getHighConvictionWallets(
  minCoveragePct: number = 2.0,
  limit: number = 100
): HighConvictionWallet[] {
  const topWallets = getTopWallets(limit, minCoveragePct)

  return topWallets.map((w, index) => ({
    wallet: w.wallet,
    realizedPnlUsd: w.realizedPnlUsd,
    coveragePct: w.coveragePct,
    rank: index + 1,
  }))
}

/**
 * Check if a wallet is high conviction
 *
 * @param walletAddress - Wallet to check
 * @param minCoveragePct - Minimum coverage % (default: 2%)
 * @returns true if wallet passes coverage threshold
 */
export function isHighConvictionWallet(
  walletAddress: string,
  minCoveragePct: number = 2.0
): boolean {
  const walletPnL = getWalletPnL(walletAddress, minCoveragePct)
  return walletPnL !== null
}

/**
 * Get wallet details if high conviction
 *
 * @param walletAddress - Wallet to look up
 * @param minCoveragePct - Minimum coverage % (default: 2%)
 * @returns Wallet details or null if not high conviction
 */
export function getHighConvictionWalletDetails(
  walletAddress: string,
  minCoveragePct: number = 2.0
): HighConvictionWallet | null {
  const walletPnL = getWalletPnL(walletAddress, minCoveragePct)

  if (!walletPnL) {
    return null
  }

  // Find rank among all high conviction wallets
  const allWallets = getHighConvictionWallets(minCoveragePct)
  const rank = allWallets.findIndex(
    (w) => w.wallet.toLowerCase() === walletAddress.toLowerCase()
  )

  return {
    wallet: walletPnL.wallet,
    realizedPnlUsd: walletPnL.realizedPnlUsd,
    coveragePct: walletPnL.coveragePct,
    rank: rank >= 0 ? rank + 1 : 999,
  }
}
