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
    description: "Export, manage, and delete your data",
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

// Connection Templates - Quick setup for common services
//
// HOW TO ADD A NEW CONNECTION TEMPLATE:
// 1. Choose the appropriate category or create a new one
// 2. Add a new template object with:
//    - name: Display name of the service
//    - type: "service" | "wallet" | "exchange"
//    - description: Short description of what it does
//    - permissions: Array of permission IDs (e.g., ["read", "trade"])
//    - fields: Array of input fields needed for configuration
//      * Each field has: name, label, type, required, placeholder
//    - note (optional): Additional information for the user
//
// Example:
// {
//   name: "New API Service",
//   type: "service",
//   description: "Connect to New API Service",
//   permissions: ["read"],
//   fields: [
//     { name: "apiKey", label: "API Key", type: "password", required: true, placeholder: "Enter API key" }
//   ],
// }
//
export const CONNECTION_TEMPLATES = [
  // AI Service APIs
  {
    category: "AI Services",
    templates: [
      {
        name: "OpenAI API",
        type: "service" as const,
        description: "GPT-4, GPT-3.5, and other OpenAI models",
        permissions: ["read"],
        fields: [
          { name: "apiKey", label: "API Key", type: "password", required: true, placeholder: "sk-..." },
        ],
      },
      {
        name: "Anthropic API",
        type: "service" as const,
        description: "Claude AI models",
        permissions: ["read"],
        fields: [
          { name: "apiKey", label: "API Key", type: "password", required: true, placeholder: "sk-ant-..." },
        ],
      },
      {
        name: "Google AI API",
        type: "service" as const,
        description: "Gemini and other Google AI models",
        permissions: ["read"],
        fields: [
          { name: "apiKey", label: "API Key", type: "password", required: true, placeholder: "AIza..." },
        ],
      },
    ],
  },
  // Prediction Market APIs
  {
    category: "Prediction Markets",
    templates: [
      {
        name: "Polymarket API",
        type: "service" as const,
        description: "Access Polymarket prediction market data",
        permissions: ["read"],
        fields: [
          { name: "apiKey", label: "API Key", type: "password", required: true, placeholder: "pm_..." },
        ],
      },
      {
        name: "Kalshi API",
        type: "service" as const,
        description: "Access Kalshi market data",
        permissions: ["read"],
        fields: [
          { name: "apiKey", label: "API Key", type: "password", required: true, placeholder: "kalshi_..." },
        ],
      },
    ],
  },
  // Data & Analytics
  {
    category: "Data & Analytics",
    templates: [
      {
        name: "Custom API",
        type: "service" as const,
        description: "Generic API connection",
        permissions: ["read"],
        fields: [
          { name: "apiUrl", label: "API URL", type: "text", required: true, placeholder: "https://api.example.com" },
          { name: "apiKey", label: "API Key", type: "password", required: true, placeholder: "Enter API key" },
        ],
      },
    ],
  },
  // Blockchain & Wallets
  {
    category: "Wallets",
    templates: [
      {
        name: "MetaMask",
        type: "wallet" as const,
        description: "Connect MetaMask wallet for trading",
        permissions: ["read", "trade"],
        fields: [],
        note: "Connect via browser extension",
      },
      {
        name: "WalletConnect",
        type: "wallet" as const,
        description: "Connect any WalletConnect-compatible wallet",
        permissions: ["read", "trade"],
        fields: [],
        note: "Scan QR code with your mobile wallet",
      },
      {
        name: "Coinbase Wallet",
        type: "wallet" as const,
        description: "Connect Coinbase Wallet",
        permissions: ["read", "trade"],
        fields: [],
        note: "Connect via browser extension or mobile app",
      },
    ],
  },
]

// Placeholder constants for legacy components
export const TRADING_PAIRS = ["ETH/USD", "BTC/USD", "MATIC/USD"]

// Trading constants
export const PREDICTION_MARKET_PLATFORMS = [
  { value: "polymarket", label: "Polymarket" },
  { value: "kalshi", label: "Kalshi" },
  { value: "manifold", label: "Manifold Markets" },
]

export const MARKET_CATEGORIES = [
  { value: "politics", label: "Politics" },
  { value: "sports", label: "Sports" },
  { value: "crypto", label: "Crypto" },
  { value: "economics", label: "Economics" },
  { value: "entertainment", label: "Entertainment" },
]

export const CHART_TIMEFRAMES = [
  { value: "1m", label: "1 Minute" },
  { value: "5m", label: "5 Minutes" },
  { value: "15m", label: "15 Minutes" },
  { value: "1h", label: "1 Hour" },
  { value: "4h", label: "4 Hours" },
  { value: "1d", label: "1 Day" },
  { value: "1w", label: "1 Week" },
]

export const PREDICTION_OUTCOMES = [
  { value: "yes", label: "YES" },
  { value: "no", label: "NO" },
]

export const EXCHANGES = [
  { value: "polymarket", label: "Polymarket" },
  { value: "kalshi", label: "Kalshi" },
  { value: "manifold", label: "Manifold Markets" },
]

export const TECHNICAL_INDICATORS = [
  "SMA",
  "EMA",
  "RSI",
  "MACD",
  "Bollinger Bands",
  "Volume",
  "ATR",
  "Stochastic",
]
