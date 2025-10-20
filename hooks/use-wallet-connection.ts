"use client"

import { useCallback, useEffect, useState } from "react"
import { useToast } from "@/hooks/use-toast"

interface WalletState {
  isConnected: boolean
  address: string
  balance: string
  chainId: number | null
  walletType: string | null
}

export function useWalletConnection() {
  const [state, setState] = useState<WalletState>({
    isConnected: false,
    address: "",
    balance: "0.00",
    chainId: null,
    walletType: null,
  })
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  // Check if wallet is already connected on mount
  useEffect(() => {
    checkConnection()
  }, [])

  const checkConnection = async () => {
    try {
      if (typeof window !== "undefined" && window.ethereum) {
        const accounts = await window.ethereum.request({ method: "eth_accounts" })
        if (accounts.length > 0) {
          const chainId = await window.ethereum.request({ method: "eth_chainId" })
          const balance = await getBalance(accounts[0])
          setState({
            isConnected: true,
            address: accounts[0],
            balance,
            chainId: Number.parseInt(chainId, 16),
            walletType: "metamask",
          })
        }
      }
    } catch (err) {
      console.error("Error checking wallet connection:", err)
    }
  }

  const getBalance = async (address: string): Promise<string> => {
    try {
      if (window.ethereum) {
        const balance = await window.ethereum.request({
          method: "eth_getBalance",
          params: [address, "latest"],
        })
        // Convert from wei to ETH
        const balanceInEth = Number.parseInt(balance, 16) / Math.pow(10, 18)
        return balanceInEth.toFixed(4)
      }
      return "0.00"
    } catch (err) {
      console.error("Error getting balance:", err)
      return "0.00"
    }
  }

  const connect = useCallback(
    async (walletId: string): Promise<boolean> => {
      setIsConnecting(true)
      setError(null)

      try {
        switch (walletId) {
          case "metamask":
            if (!window.ethereum) {
              throw new Error("MetaMask is not installed. Please install MetaMask to continue.")
            }

            const accounts = await window.ethereum.request({
              method: "eth_requestAccounts",
            })

            if (accounts.length === 0) {
              throw new Error("No accounts found. Please check your MetaMask wallet.")
            }

            const chainId = await window.ethereum.request({ method: "eth_chainId" })
            const balance = await getBalance(accounts[0])

            setState({
              isConnected: true,
              address: accounts[0],
              balance,
              chainId: Number.parseInt(chainId, 16),
              walletType: "metamask",
            })

            toast({
              title: "Wallet Connected",
              description: `Successfully connected to ${accounts[0].slice(0, 6)}...${accounts[0].slice(-4)}`,
            })

            return true

          case "walletconnect":
            // Implement WalletConnect logic here
            throw new Error("WalletConnect integration coming soon!")

          case "coinbase":
            // Implement Coinbase Wallet logic here
            throw new Error("Coinbase Wallet integration coming soon!")

          case "phantom":
            // Implement Phantom wallet logic here
            throw new Error("Phantom wallet integration coming soon!")

          default:
            throw new Error("Unsupported wallet provider")
        }
      } catch (err: any) {
        const errorMessage = err.message || "Failed to connect wallet"
        setError(errorMessage)
        toast({
          title: "Connection Failed",
          description: errorMessage,
          variant: "destructive",
        })
        return false
      } finally {
        setIsConnecting(false)
      }
    },
    [toast],
  )

  const disconnect = useCallback(() => {
    setState({
      isConnected: false,
      address: "",
      balance: "0.00",
      chainId: null,
      walletType: null,
    })
    setError(null)
    toast({
      title: "Wallet Disconnected",
      description: "Your wallet has been disconnected successfully",
    })
  }, [toast])

  const copyAddress = useCallback(() => {
    if (state.address) {
      navigator.clipboard.writeText(state.address)
      toast({
        title: "Address Copied",
        description: "Wallet address copied to clipboard",
      })
    }
  }, [state.address, toast])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  // Listen for account changes
  useEffect(() => {
    if (window.ethereum) {
      const handleAccountsChanged = (accounts: string[]) => {
        if (accounts.length === 0) {
          disconnect()
        } else if (accounts[0] !== state.address) {
          // Account changed, update state
          checkConnection()
        }
      }

      const handleChainChanged = () => {
        // Reload the page when chain changes
        window.location.reload()
      }

      window.ethereum.on("accountsChanged", handleAccountsChanged)
      window.ethereum.on("chainChanged", handleChainChanged)

      return () => {
        window.ethereum.removeListener("accountsChanged", handleAccountsChanged)
        window.ethereum.removeListener("chainChanged", handleChainChanged)
      }
    }
  }, [state.address, disconnect])

  return {
    ...state,
    isConnecting,
    error,
    connect,
    disconnect,
    copyAddress,
    clearError,
  }
}

// Extend Window interface for TypeScript
declare global {
  interface Window {
    ethereum?: any
  }
}
