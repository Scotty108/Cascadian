/**
 * Wallet P&L Feed
 *
 * Official loader for audited_wallet_pnl_extended.json from Path B.
 * This is the ONLY approved P&L source. No legacy columns. No invented P&L.
 *
 * Governance rules:
 * - Only wallets in audited_wallet_pnl_extended.json are "scored"
 * - All 548 wallets already have coverage ≥2%
 * - This is the authoritative "signal wallets" list
 * - Coverage threshold is ALWAYS enforced (≥2%)
 */

// Import JSON directly (works in both Node.js and browser)
import auditedWalletData from '@/audited_wallet_pnl_extended.json'

export interface AuditedWalletPnL {
  wallet_address: string
  realized_pnl_usd: number
  coverage_pct: number
}

export interface TopWallet {
  wallet: string
  realizedPnlUsd: number
  coveragePct: number
}

/**
 * Load audited P&L data from imported JSON
 *
 * Data is imported at build time, so it's always available.
 */
function loadAuditedPnL(): AuditedWalletPnL[] {
  return auditedWalletData as AuditedWalletPnL[]
}

/**
 * Get top wallets by realized P&L
 *
 * @param limit - Maximum number of wallets to return (default: all)
 * @param minCoveragePct - Minimum coverage % required (default: 2%)
 *
 * Returns wallets sorted by realized_pnl_usd descending.
 * ONLY includes wallets meeting coverage threshold.
 *
 * This is the official "who are the good wallets" list for downstream systems.
 */
export function getTopWallets(
  limit?: number,
  minCoveragePct: number = 2.0
): TopWallet[] {
  const allWallets = loadAuditedPnL()

  // Filter by coverage threshold (governance rule)
  const qualifiedWallets = allWallets.filter(
    (w) => w.coverage_pct >= minCoveragePct
  )

  // Sort by realized P&L descending
  const sorted = qualifiedWallets.sort(
    (a, b) => b.realized_pnl_usd - a.realized_pnl_usd
  )

  // Apply limit if specified
  const limited = limit ? sorted.slice(0, limit) : sorted

  // Map to clean interface
  return limited.map((w) => ({
    wallet: w.wallet_address,
    realizedPnlUsd: w.realized_pnl_usd,
    coveragePct: w.coverage_pct,
  }))
}

/**
 * Check if a wallet is in the approved list
 *
 * @param walletAddress - Wallet to check
 * @param minCoveragePct - Minimum coverage % required (default: 2%)
 *
 * Returns true if wallet has audited P&L and meets coverage threshold.
 */
export function isApprovedWallet(
  walletAddress: string,
  minCoveragePct: number = 2.0
): boolean {
  const allWallets = loadAuditedPnL()
  const wallet = allWallets.find(
    (w) => w.wallet_address.toLowerCase() === walletAddress.toLowerCase()
  )
  return wallet !== undefined && wallet.coverage_pct >= minCoveragePct
}

/**
 * Get P&L for a specific wallet
 *
 * Returns null if wallet not in audited list or below coverage threshold.
 */
export function getWalletPnL(
  walletAddress: string,
  minCoveragePct: number = 2.0
): TopWallet | null {
  const allWallets = loadAuditedPnL()

  const wallet = allWallets.find(
    (w) => w.wallet_address.toLowerCase() === walletAddress.toLowerCase()
  )

  if (!wallet || wallet.coverage_pct < minCoveragePct) {
    return null
  }

  return {
    wallet: wallet.wallet_address,
    realizedPnlUsd: wallet.realized_pnl_usd,
    coveragePct: wallet.coverage_pct,
  }
}

/**
 * Force reload of audited P&L data
 *
 * Note: Data is imported at build time, so this function is a no-op.
 * To update data, rebuild the application.
 */
export function reloadAuditedPnL(): void {
  // No-op: data is imported at build time
}
