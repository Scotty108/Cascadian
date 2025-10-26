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

import * as fs from 'fs'
import * as path from 'path'

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

// Cache for loaded P&L data
let cachedPnLData: AuditedWalletPnL[] | null = null
let cacheTimestamp: number = 0
const CACHE_TTL_MS = 60 * 1000 // 1 minute

/**
 * Load audited P&L data from JSON file
 *
 * Uses filesystem cache to avoid re-reading every call.
 * When Path B updates audited_wallet_pnl.json, cache expires.
 */
function loadAuditedPnL(): AuditedWalletPnL[] {
  const now = Date.now()

  // Return cached data if fresh
  if (cachedPnLData && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedPnLData
  }

  // Load from file
  const filePath = path.join(process.cwd(), 'audited_wallet_pnl_extended.json')

  if (!fs.existsSync(filePath)) {
    console.warn('⚠️  audited_wallet_pnl_extended.json not found - using empty list')
    cachedPnLData = []
    cacheTimestamp = now
    return []
  }

  const rawData = fs.readFileSync(filePath, 'utf-8')
  cachedPnLData = JSON.parse(rawData) as AuditedWalletPnL[]
  cacheTimestamp = now

  return cachedPnLData
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
 * Call this when audited_wallet_pnl.json is updated by Path B.
 */
export function reloadAuditedPnL(): void {
  cachedPnLData = null
  cacheTimestamp = 0
}
