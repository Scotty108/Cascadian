import type { WalletType, Network } from "./types"
import { walletTypes, networks } from "./data"

// Format currency
export const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

// Format crypto amount
export const formatCrypto = (value: number): string => {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value)
}

// Format date
export const formatDate = (date: Date): string => {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

// Shorten address
export const shortenAddress = (address: string): string => {
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`
}

// Get wallet type details
export const getWalletType = (typeId: string): WalletType => {
  return walletTypes.find((type) => type.id === typeId) || walletTypes[0]
}

// Get network details
export const getNetwork = (networkId: string): Network => {
  return networks.find((network) => network.id === networkId) || networks[0]
}

// Calculate total portfolio balance
export const calculateTotalBalance = (wallets: any[]): number => {
  return wallets.reduce((sum, wallet) => sum + wallet.totalBalance, 0)
}

// Get security badge variant
export const getSecurityBadgeVariant = (level: string) => {
  switch (level) {
    case "very high":
    case "high":
      return "default"
    case "medium":
      return "secondary"
    case "low":
      return "destructive"
    default:
      return "secondary"
  }
}

// Get security badge text
export const getSecurityBadgeText = (level: string) => {
  switch (level) {
    case "very high":
    case "high":
      return "Secure"
    case "medium":
      return "Moderate"
    case "low":
      return "At Risk"
    default:
      return "Unknown"
  }
}
