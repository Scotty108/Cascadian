"use client"

import { useState, useMemo } from "react"
import type { WalletState } from "../types"
import { wallets } from "../data"

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    activeWallet: wallets[0]?.id || "",
    activeTab: "overview",
    activeNetwork: "all",
    showConnectWallet: false,
    showAddressBook: false,
    showBackup: false,
    showSecurity: false,
  })

  // Get current wallet
  const currentWallet = useMemo(() => {
    return wallets.find((wallet) => wallet.id === state.activeWallet)
  }, [state.activeWallet])

  // Filter assets by network
  const filteredAssets = useMemo(() => {
    if (!currentWallet) return []

    return currentWallet.networks.flatMap((network) => {
      if (state.activeNetwork === "all" || network.networkId === state.activeNetwork) {
        return network.assets.map((asset) => ({
          ...asset,
          networkId: network.networkId,
        }))
      }
      return []
    })
  }, [currentWallet, state.activeNetwork])

  // Filter transactions by network
  const filteredTransactions = useMemo(() => {
    if (!currentWallet) return []

    return currentWallet.transactions.filter(
      (tx) => state.activeNetwork === "all" || tx.networkId === state.activeNetwork,
    )
  }, [currentWallet, state.activeNetwork])

  // Update state functions
  const setActiveWallet = (walletId: string) => {
    setState((prev) => ({ ...prev, activeWallet: walletId }))
  }

  const setActiveTab = (tab: string) => {
    setState((prev) => ({ ...prev, activeTab: tab }))
  }

  const setActiveNetwork = (network: string) => {
    setState((prev) => ({ ...prev, activeNetwork: network }))
  }

  const setShowConnectWallet = (show: boolean) => {
    setState((prev) => ({ ...prev, showConnectWallet: show }))
  }

  const setShowAddressBook = (show: boolean) => {
    setState((prev) => ({ ...prev, showAddressBook: show }))
  }

  const setShowBackup = (show: boolean) => {
    setState((prev) => ({ ...prev, showBackup: show }))
  }

  const setShowSecurity = (show: boolean) => {
    setState((prev) => ({ ...prev, showSecurity: show }))
  }

  return {
    // State
    ...state,
    currentWallet,
    filteredAssets,
    filteredTransactions,

    // Actions
    setActiveWallet,
    setActiveTab,
    setActiveNetwork,
    setShowConnectWallet,
    setShowAddressBook,
    setShowBackup,
    setShowSecurity,
  }
}
