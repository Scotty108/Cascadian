import type { SettingsTab } from "./types"

export const SETTINGS_TABS: SettingsTab[] = [
  {
    id: "profile",
    label: "Profile",
    icon: "User",
    description: "Manage your personal information and profile settings",
  },
  {
    id: "security",
    label: "Security",
    icon: "Shield",
    description: "Password, 2FA, API keys, and security settings",
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: "Bell",
    description: "Configure alerts for markets, whales, and insider activity",
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: "Palette",
    description: "Theme, layout, language, and accessibility settings",
  },
  {
    id: "data",
    label: "Data",
    icon: "Database",
    description: "Data export, retention, and account management",
  },
  {
    id: "connections",
    label: "Connections",
    icon: "Wallet",
    description: "Connect your wallets to trade on Polymarket",
  },
]

export const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "it", label: "Italiano" },
  { value: "pt", label: "Português" },
  { value: "ru", label: "Русский" },
  { value: "zh", label: "中文" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
]

export const TIMEZONES = [
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "Eastern Time" },
  { value: "America/Chicago", label: "Central Time" },
  { value: "America/Denver", label: "Mountain Time" },
  { value: "America/Los_Angeles", label: "Pacific Time" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Paris", label: "Paris" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Asia/Shanghai", label: "Shanghai" },
  { value: "Asia/Singapore", label: "Singapore" },
]

// Wallet providers for Polymarket trading
export const WALLET_PROVIDERS = [
  { value: "metamask", label: "MetaMask" },
  { value: "walletconnect", label: "WalletConnect" },
  { value: "coinbase", label: "Coinbase Wallet" },
  { value: "polymarket", label: "Polymarket Wallet" },
]

export const PASSWORD_REQUIREMENTS = [
  "At least 8 characters long",
  "Contains uppercase letter",
  "Contains lowercase letter",
  "Contains number",
  "Contains special character",
]

export const DATA_RETENTION_OPTIONS = [
  { value: 30, label: "30 days" },
  { value: 90, label: "3 months" },
  { value: 180, label: "6 months" },
  { value: 365, label: "1 year" },
  { value: 730, label: "2 years" },
  { value: -1, label: "Forever" },
]

export const EXPORT_FORMATS = [
  { value: "json", label: "JSON" },
  { value: "csv", label: "CSV" },
  { value: "xlsx", label: "Excel" },
]
