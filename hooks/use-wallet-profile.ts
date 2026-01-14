/**
 * Fetch wallet profile data from Polymarket
 */

import { useState, useEffect } from 'react'

export interface WalletProfile {
  address: string
  username?: string
  pseudonym?: string
  bio?: string
  profilePicture?: string
  twitterHandle?: string
  websiteUrl?: string
  polymarketUrl?: string
  pnl?: number  // Total PnL from Polymarket's profile page
}

export function useWalletProfile(walletAddress: string) {
  const [profile, setProfile] = useState<WalletProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    async function fetchProfile() {
      if (!walletAddress) {
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/polymarket/wallet/${walletAddress}/profile`)

        if (!response.ok) {
          throw new Error(`Failed to fetch profile: ${response.statusText}`)
        }

        const data = await response.json()

        if (data.success && data.data) {
          setProfile(data.data)
        } else {
          // No profile data available - use default
          setProfile({
            address: walletAddress,
          })
        }
      } catch (err) {
        console.error('Error fetching wallet profile:', err)
        setError(err instanceof Error ? err : new Error('Unknown error'))
        // Set default profile on error
        setProfile({
          address: walletAddress,
        })
      } finally {
        setIsLoading(false)
      }
    }

    fetchProfile()
  }, [walletAddress])

  return { profile, isLoading, error }
}
