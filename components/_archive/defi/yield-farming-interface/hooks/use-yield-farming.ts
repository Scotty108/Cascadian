"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import type {
  YieldFarmingState,
  FilterState,
  YieldFarmingOpportunity,
  WalletState,
  TransactionState,
  NotificationState,
} from "../types"
import { DEFAULT_FILTER_STATE, DEFAULT_IL_CALCULATOR_VALUES } from "../constants"
import { yieldFarmingOpportunities, userFarms } from "../data"
import { filterOpportunities, calculateOptimalYield, assessRiskLevel } from "../utils"

export const useYieldFarming = () => {
  const [state, setState] = useState<YieldFarmingState>({
    activeTab: "all",
    filteredOpportunities: yieldFarmingOpportunities,
    favoriteOpportunities: [],
    selectedOpportunity: null,
    showFilters: false,
    showImpermanentLossCalculator: false,
    showAdvancedSettings: false,
    gasOption: "average",
    autocompoundEnabled: true,
    harvestThreshold: 50,
    ilCalculatorValues: DEFAULT_IL_CALCULATOR_VALUES,
  })

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTER_STATE)

  // New state for enhanced features
  const [walletState, setWalletState] = useState<WalletState>({
    isConnected: false,
    address: null,
    balance: 0,
    chainId: 1,
    supportedTokens: [],
  })

  const [transactionState, setTransactionState] = useState<TransactionState>({
    pending: [],
    completed: [],
    failed: [],
  })

  const [notifications, setNotifications] = useState<NotificationState>({
    alerts: [],
    settings: {
      apyChanges: true,
      harvestReminders: true,
      riskWarnings: true,
      newOpportunities: true,
    },
  })

  const [realTimeData, setRealTimeData] = useState<{
    lastUpdate: Date
    priceUpdates: Record<string, number>
    apyUpdates: Record<string, number>
  }>({
    lastUpdate: new Date(),
    priceUpdates: {},
    apyUpdates: {},
  })

  const addNotification = useCallback((notification: any) => {
    setNotifications((prev) => ({
      ...prev,
      alerts: [notification, ...prev.alerts].slice(0, 50), // Keep last 50 notifications
    }))
  }, [])

  // Real-time data simulation
  useEffect(() => {
    const interval = setInterval(() => {
      const updates: Record<string, number> = {}
      yieldFarmingOpportunities.forEach((opp) => {
        // Simulate APY fluctuations (±0.5%)
        const change = (Math.random() - 0.5) * 1
        updates[opp.id] = Math.max(0.1, opp.apy + change)
      })

      setRealTimeData((prev) => ({
        ...prev,
        lastUpdate: new Date(),
        apyUpdates: updates,
      }))
    }, 30000) // Update every 30 seconds

    return () => clearInterval(interval)
  }, [])

  // Auto-compound monitoring
  useEffect(() => {
    if (!state.autocompoundEnabled || !walletState.isConnected) return

    const checkHarvestOpportunities = () => {
      userFarms.forEach((farm) => {
        if (farm.rewards * 100 >= state.harvestThreshold) {
          // Assuming rewards are in hundreds
          addNotification({
            id: Date.now(),
            type: "harvest",
            title: "Harvest Opportunity",
            message: `${farm.protocol} farm has ${farm.rewards} rewards ready to harvest`,
            timestamp: new Date(),
            read: false,
          })
        }
      })
    }

    const interval = setInterval(checkHarvestOpportunities, 300000) // Check every 5 minutes
    return () => clearInterval(interval)
  }, [state.autocompoundEnabled, state.harvestThreshold, walletState.isConnected, addNotification])

  // Calculate derived values with real-time updates
  const totalPortfolioValue = useMemo(() => {
    return userFarms.reduce((total, farm) => {
      const priceMultiplier = realTimeData.priceUpdates[farm.id] || 1
      return total + farm.depositValue * priceMultiplier
    }, 0)
  }, [realTimeData.priceUpdates])

  const totalRewards = useMemo(() => userFarms.reduce((total, farm) => total + farm.rewards, 0), [])

  const userFarmIds = useMemo(() => userFarms.map((farm) => farm.id), [])

  // Enhanced opportunities with real-time data
  const enhancedOpportunities = useMemo(() => {
    return yieldFarmingOpportunities.map((opp) => ({
      ...opp,
      apy: realTimeData.apyUpdates[opp.id] || opp.apy,
      riskScore: assessRiskLevel(opp),
      optimizationSuggestion: calculateOptimalYield(opp, walletState.balance),
    }))
  }, [realTimeData.apyUpdates, walletState.balance])

  // Filter opportunities when filters or state changes
  useEffect(() => {
    const filtered = filterOpportunities(
      enhancedOpportunities,
      filters,
      state.activeTab,
      state.favoriteOpportunities,
      userFarmIds,
    )
    setState((prev) => ({ ...prev, filteredOpportunities: filtered }))
  }, [filters, state.activeTab, state.favoriteOpportunities, userFarmIds, enhancedOpportunities])

  // Wallet connection functions
  const connectWallet = useCallback(async () => {
    try {
      // Simulate wallet connection
      setWalletState((prev) => ({
        ...prev,
        isConnected: true,
        address: "0x1234...5678",
        balance: 10000, // $10,000 USD equivalent
        supportedTokens: ["ETH", "USDC", "DAI", "WBTC"],
      }))

      addNotification({
        id: Date.now(),
        type: "success",
        title: "Wallet Connected",
        message: "Successfully connected to MetaMask",
        timestamp: new Date(),
        read: false,
      })
    } catch (error) {
      addNotification({
        id: Date.now(),
        type: "error",
        title: "Connection Failed",
        message: "Failed to connect wallet. Please try again.",
        timestamp: new Date(),
        read: false,
      })
    }
  }, [addNotification])

  const disconnectWallet = useCallback(() => {
    setWalletState({
      isConnected: false,
      address: null,
      balance: 0,
      chainId: 1,
      supportedTokens: [],
    })
  }, [])

  // Transaction functions
  const executeDeposit = useCallback(async (opportunityId: number, amount: number) => {
    const txId = Date.now().toString()

    setTransactionState((prev) => ({
      ...prev,
      pending: [
        ...prev.pending,
        {
          id: txId,
          type: "deposit",
          opportunityId,
          amount,
          timestamp: new Date(),
          status: "pending",
        },
      ],
    }))

    // Simulate transaction processing
    setTimeout(() => {
      setTransactionState((prev) => ({
        ...prev,
        pending: prev.pending.filter((tx) => tx.id !== txId),
        completed: [
          ...prev.completed,
          {
            id: txId,
            type: "deposit",
            opportunityId,
            amount,
            timestamp: new Date(),
            status: "completed",
            hash: `0x${Math.random().toString(16).substr(2, 64)}`,
          },
        ],
      }))

      addNotification({
        id: Date.now(),
        type: "success",
        title: "Deposit Successful",
        message: `Successfully deposited ${amount} into yield farm`,
        timestamp: new Date(),
        read: false,
      })
    }, 3000)
  }, [addNotification])

  const executeWithdraw = useCallback(async (farmId: number, amount: number) => {
    const txId = Date.now().toString()

    setTransactionState((prev) => ({
      ...prev,
      pending: [
        ...prev.pending,
        {
          id: txId,
          type: "withdraw",
          opportunityId: farmId,
          amount,
          timestamp: new Date(),
          status: "pending",
        },
      ],
    }))

    setTimeout(() => {
      setTransactionState((prev) => ({
        ...prev,
        pending: prev.pending.filter((tx) => tx.id !== txId),
        completed: [
          ...prev.completed,
          {
            id: txId,
            type: "withdraw",
            opportunityId: farmId,
            amount,
            timestamp: new Date(),
            status: "completed",
            hash: `0x${Math.random().toString(16).substr(2, 64)}`,
          },
        ],
      }))

      addNotification({
        id: Date.now(),
        type: "success",
        title: "Withdrawal Successful",
        message: `Successfully withdrew ${amount} from yield farm`,
        timestamp: new Date(),
        read: false,
      })
    }, 3000)
  }, [addNotification])

  const executeHarvest = useCallback(async (farmId: number) => {
    const farm = userFarms.find((f) => f.id === farmId)
    if (!farm) return

    const txId = Date.now().toString()

    setTransactionState((prev) => ({
      ...prev,
      pending: [
        ...prev.pending,
        {
          id: txId,
          type: "harvest",
          opportunityId: farmId,
          amount: farm.rewards,
          timestamp: new Date(),
          status: "pending",
        },
      ],
    }))

    setTimeout(() => {
      setTransactionState((prev) => ({
        ...prev,
        pending: prev.pending.filter((tx) => tx.id !== txId),
        completed: [
          ...prev.completed,
          {
            id: txId,
            type: "harvest",
            opportunityId: farmId,
            amount: farm.rewards,
            timestamp: new Date(),
            status: "completed",
            hash: `0x${Math.random().toString(16).substr(2, 64)}`,
          },
        ],
      }))

      addNotification({
        id: Date.now(),
        type: "success",
        title: "Harvest Successful",
        message: `Successfully harvested ${farm.rewards} in rewards`,
        timestamp: new Date(),
        read: false,
      })
    }, 2000)
  }, [addNotification])

  

  const markNotificationRead = useCallback((id: number) => {
    setNotifications((prev) => ({
      ...prev,
      alerts: prev.alerts.map((alert) => (alert.id === id ? { ...alert, read: true } : alert)),
    }))
  }, [])

  const clearNotifications = useCallback(() => {
    setNotifications((prev) => ({
      ...prev,
      alerts: [],
    }))
  }, [])

  // Original actions
  const setActiveTab = (tab: string) => {
    setState((prev) => ({ ...prev, activeTab: tab }))
  }

  const updateFilters = (newFilters: Partial<FilterState>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }))
  }

  const toggleFavorite = (id: number) => {
    setState((prev) => ({
      ...prev,
      favoriteOpportunities: prev.favoriteOpportunities.includes(id)
        ? prev.favoriteOpportunities.filter((oppId) => oppId !== id)
        : [...prev.favoriteOpportunities, id],
    }))
  }

  const selectOpportunity = (opportunity: YieldFarmingOpportunity | null) => {
    setState((prev) => ({ ...prev, selectedOpportunity: opportunity }))
  }

  const toggleFilters = () => {
    setState((prev) => ({ ...prev, showFilters: !prev.showFilters }))
  }

  const toggleImpermanentLossCalculator = () => {
    setState((prev) => ({ ...prev, showImpermanentLossCalculator: !prev.showImpermanentLossCalculator }))
  }

  const toggleAdvancedSettings = () => {
    setState((prev) => ({ ...prev, showAdvancedSettings: !prev.showAdvancedSettings }))
  }

  const setGasOption = (option: string) => {
    setState((prev) => ({ ...prev, gasOption: option }))
  }

  const setAutocompoundEnabled = (enabled: boolean) => {
    setState((prev) => ({ ...prev, autocompoundEnabled: enabled }))
  }

  const setHarvestThreshold = (threshold: number) => {
    setState((prev) => ({ ...prev, harvestThreshold: threshold }))
  }

  const updateIlCalculatorValues = (values: Partial<typeof state.ilCalculatorValues>) => {
    setState((prev) => ({
      ...prev,
      ilCalculatorValues: { ...prev.ilCalculatorValues, ...values },
    }))
  }

  const resetFilters = () => {
    setFilters(DEFAULT_FILTER_STATE)
  }

  return {
    // Original state
    ...state,
    filters,
    totalPortfolioValue,
    totalRewards,
    userFarms,

    // Enhanced state
    walletState,
    transactionState,
    notifications,
    realTimeData,
    enhancedOpportunities,

    // Original actions
    setActiveTab,
    updateFilters,
    toggleFavorite,
    selectOpportunity,
    toggleFilters,
    toggleImpermanentLossCalculator,
    toggleAdvancedSettings,
    setGasOption,
    setAutocompoundEnabled,
    setHarvestThreshold,
    updateIlCalculatorValues,
    resetFilters,

    // Enhanced actions
    connectWallet,
    disconnectWallet,
    executeDeposit,
    executeWithdraw,
    executeHarvest,
    addNotification,
    markNotificationRead,
    clearNotifications,
  }
}
