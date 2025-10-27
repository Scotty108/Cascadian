/**
 * Wallet Signal Set
 *
 * Provides the authoritative list of "signal wallets" (trusted wallets with coverage ≥2%).
 * All 548 wallets in audited_wallet_pnl_extended.json have passed coverage threshold.
 *
 * This is the foundation for:
 * - Auto-populating strategy watchlists
 * - Monitoring wallet positions
 * - Filtering escalation candidates
 * - Generating alerts
 *
 * Governance:
 * - Single source of truth: audited_wallet_pnl_extended.json
 * - Coverage threshold: 2% (already enforced in source file)
 * - Count: 548 wallets
 */

import { getTopWallets, type TopWallet } from '@/lib/data/wallet-pnl-feed'

export interface SignalWallet {
  address: string
  realizedPnlUsd: number
  coveragePct: number
  rank: number
}

/**
 * Get all signal wallets (trusted wallets with coverage ≥2%)
 *
 * Returns all 548 wallets from audited_wallet_pnl_extended.json.
 * All wallets have already passed coverage threshold.
 *
 * @returns Array of all signal wallets sorted by realized P&L descending
 *
 * Usage:
 * ```typescript
 * const signalWallets = getSignalWallets()
 * console.log(`Monitoring ${signalWallets.length} trusted wallets`)
 * ```
 */
export function getSignalWallets(): SignalWallet[] {
  // Get all wallets (no limit)
  const topWallets = getTopWallets(undefined, 2.0)

  return topWallets.map((w, index) => ({
    address: w.wallet,
    realizedPnlUsd: w.realizedPnlUsd,
    coveragePct: w.coveragePct,
    rank: index + 1,
  }))
}

/**
 * Get just the wallet addresses (for quick membership checks)
 *
 * @returns Set of wallet addresses for O(1) lookups
 *
 * Usage:
 * ```typescript
 * const signalWalletAddresses = getSignalWalletAddresses()
 * if (signalWalletAddresses.has(wallet.toLowerCase())) {
 *   // This is a trusted wallet
 * }
 * ```
 */
export function getSignalWalletAddresses(): Set<string> {
  const wallets = getSignalWallets()
  return new Set(wallets.map((w) => w.address.toLowerCase()))
}

/**
 * Check if a wallet is in the signal set
 *
 * @param walletAddress - Wallet address to check
 * @returns true if wallet is in the signal set
 *
 * Usage:
 * ```typescript
 * if (isSignalWallet('0xb744f56635b537e859152d14b022af5afe485210')) {
 *   console.log('This is a trusted wallet!')
 * }
 * ```
 */
export function isSignalWallet(walletAddress: string): boolean {
  const signalAddresses = getSignalWalletAddresses()
  return signalAddresses.has(walletAddress.toLowerCase())
}

/**
 * Get top N signal wallets
 *
 * @param limit - Number of wallets to return
 * @returns Top N signal wallets by realized P&L
 *
 * Usage:
 * ```typescript
 * const top10 = getTopSignalWallets(10)
 * console.log('Top 10 wallets:', top10.map(w => w.address))
 * ```
 */
export function getTopSignalWallets(limit: number): SignalWallet[] {
  return getSignalWallets().slice(0, limit)
}

/**
 * Get signal wallet by address
 *
 * @param walletAddress - Wallet address to look up
 * @returns Signal wallet details or null if not found
 *
 * Usage:
 * ```typescript
 * const wallet = getSignalWalletByAddress('0xb744f56...')
 * if (wallet) {
 *   console.log(`Rank: ${wallet.rank}, P&L: $${wallet.realizedPnlUsd}`)
 * }
 * ```
 */
export function getSignalWalletByAddress(
  walletAddress: string
): SignalWallet | null {
  const wallets = getSignalWallets()
  return (
    wallets.find(
      (w) => w.address.toLowerCase() === walletAddress.toLowerCase()
    ) || null
  )
}

/**
 * Get count of signal wallets
 *
 * @returns Total number of signal wallets (should be 548)
 *
 * Usage:
 * ```typescript
 * console.log(`Monitoring ${getSignalWalletCount()} trusted wallets`)
 * ```
 */
export function getSignalWalletCount(): number {
  return getSignalWallets().length
}
