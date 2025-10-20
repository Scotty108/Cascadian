import type {
  SettingsState,
  UserProfile,
  SecuritySettings,
  NotificationSettings,
  AppearanceSettings,
  TradingSettings,
  BotSettings,
  PrivacySettings,
  DataSettings,
  Connection,
  ApiKey,
  Session,
  LoginHistory,
} from "./types"

export const defaultProfile: UserProfile = {
  id: "1",
  firstName: "John",
  lastName: "Doe",
  email: "john.doe@example.com",
  phone: "+1 (555) 123-4567",
  bio: "Experienced crypto trader and DeFi enthusiast",
  avatar: "/placeholder.svg?height=100&width=100",
  location: "New York, NY",
  website: "https://johndoe.com",
  company: "Crypto Ventures Inc.",
  position: "Senior Trader",
  experience: "5+ years",
  socialProfiles: {
    twitter: "@johndoe",
    linkedin: "john-doe",
    github: "johndoe",
    telegram: "@johndoe",
  },
}

export const defaultSecuritySettings: SecuritySettings = {
  twoFactorEnabled: true,
  emailNotifications: true,
  smsNotifications: false,
  loginAlerts: true,
  apiKeysEnabled: true,
  sessionTimeout: 30,
}

export const defaultNotificationSettings: NotificationSettings = {
  email: {
    trading: true,
    bots: true,
    account: true,
    marketing: false,
    security: true,
  },
  push: {
    trading: true,
    bots: true,
    account: true,
    priceAlerts: true,
  },
  sms: {
    security: true,
    criticalAlerts: true,
  },
  inApp: {
    all: true,
    trading: true,
    bots: true,
    system: true,
  },
}

export const defaultAppearanceSettings: AppearanceSettings = {
  theme: "system",
  density: "comfortable",
  language: "en",
  dateFormat: "MM/DD/YYYY",
  timeFormat: "12h",
  timezone: "America/New_York",
  accessibility: {
    highContrast: false,
    reducedMotion: false,
    largeText: false,
    screenReader: false,
  },
}

export const defaultTradingSettings: TradingSettings = {
  defaultExchange: "binance",
  defaultTradingPair: "BTC/USDT",
  orderDefaults: {
    orderType: "limit",
    timeInForce: "GTC",
    postOnly: false,
    reduceOnly: false,
  },
  riskManagement: {
    maxPositionSize: 10000,
    stopLossPercentage: 5,
    takeProfitPercentage: 10,
    maxDailyLoss: 1000,
    maxOpenPositions: 5,
  },
  chartPreferences: {
    defaultTimeframe: "1h",
    chartType: "candlestick",
    indicators: ["RSI", "MACD"],
    theme: "dark",
  },
}

export const defaultBotSettings: BotSettings = {
  defaultParameters: {
    maxInvestment: 1000,
    riskLevel: "medium",
    tradingPairs: ["BTC/USDT", "ETH/USDT"],
    stopLoss: 5,
    takeProfit: 10,
  },
  riskManagement: {
    maxConcurrentBots: 3,
    maxDailyTrades: 50,
    emergencyStop: true,
    drawdownLimit: 20,
  },
  behavior: {
    autoStart: false,
    autoRestart: true,
    pauseOnLoss: true,
    adaptiveParameters: false,
  },
  monitoring: {
    performanceAlerts: true,
    errorNotifications: true,
    dailyReports: true,
    weeklyAnalysis: false,
  },
}

export const defaultPrivacySettings: PrivacySettings = {
  dataSharing: {
    analytics: true,
    marketing: false,
    thirdParty: false,
    research: false,
  },
  profilePrivacy: {
    publicProfile: false,
    showTradingStats: false,
    showPortfolio: false,
    allowMessages: true,
  },
  cookiesTracking: {
    essential: true,
    analytics: true,
    marketing: false,
    preferences: true,
  },
  securityPrivacy: {
    loginHistory: true,
    deviceTracking: true,
    locationTracking: false,
    biometricData: false,
  },
}

export const defaultDataSettings: DataSettings = {
  retention: {
    tradingHistory: 365,
    botLogs: 90,
    personalData: 730,
    analyticsData: 180,
  },
  export: {
    format: "json",
    includePersonalData: true,
    includeTradingData: true,
    includeBotData: true,
  },
}

export const mockConnections: Connection[] = [
  {
    id: "1",
    name: "Binance",
    type: "exchange",
    status: "connected",
    lastSync: "2024-01-15T10:30:00Z",
    permissions: ["read", "trade"],
    icon: "/placeholder.svg?height=32&width=32",
  },
  {
    id: "2",
    name: "MetaMask",
    type: "wallet",
    status: "connected",
    lastSync: "2024-01-15T09:15:00Z",
    permissions: ["read"],
    icon: "/placeholder.svg?height=32&width=32",
  },
  {
    id: "3",
    name: "TradingView",
    type: "service",
    status: "disconnected",
    lastSync: "2024-01-10T14:20:00Z",
    permissions: ["read"],
    icon: "/placeholder.svg?height=32&width=32",
  },
]

export const mockApiKeys: ApiKey[] = [
  {
    id: "1",
    name: "Trading Bot API",
    key: "sk_live_***************",
    permissions: ["read", "trade"],
    lastUsed: "2024-01-15T08:30:00Z",
    created: "2024-01-01T00:00:00Z",
    status: "active",
  },
  {
    id: "2",
    name: "Analytics API",
    key: "sk_live_***************",
    permissions: ["read"],
    lastUsed: "2024-01-14T16:45:00Z",
    created: "2024-01-05T00:00:00Z",
    status: "active",
  },
]

export const mockSessions: Session[] = [
  {
    id: "1",
    device: "MacBook Pro",
    location: "New York, NY",
    ip: "192.168.1.100",
    lastActive: "2024-01-15T10:30:00Z",
    current: true,
    browser: "Chrome 120",
    os: "macOS 14.2",
  },
  {
    id: "2",
    device: "iPhone 15 Pro",
    location: "New York, NY",
    ip: "192.168.1.101",
    lastActive: "2024-01-15T09:15:00Z",
    current: false,
    browser: "Safari 17",
    os: "iOS 17.2",
  },
]

export const mockLoginHistory: LoginHistory[] = [
  {
    id: "1",
    timestamp: "2024-01-15T10:30:00Z",
    ip: "192.168.1.100",
    location: "New York, NY",
    device: "MacBook Pro",
    success: true,
    method: "password",
  },
  {
    id: "2",
    timestamp: "2024-01-15T09:15:00Z",
    ip: "192.168.1.101",
    location: "New York, NY",
    device: "iPhone 15 Pro",
    success: true,
    method: "2fa",
  },
  {
    id: "3",
    timestamp: "2024-01-14T22:45:00Z",
    ip: "203.0.113.1",
    location: "Unknown",
    device: "Unknown",
    success: false,
    method: "password",
  },
]

export const defaultSettingsState: SettingsState = {
  profile: defaultProfile,
  security: defaultSecuritySettings,
  notifications: defaultNotificationSettings,
  appearance: defaultAppearanceSettings,
  trading: defaultTradingSettings,
  bots: defaultBotSettings,
  privacy: defaultPrivacySettings,
  data: defaultDataSettings,
  connections: mockConnections,
  apiKeys: mockApiKeys,
  sessions: mockSessions,
  loginHistory: mockLoginHistory,
  activeTab: "profile",
  isLoading: false,
  hasUnsavedChanges: false,
}
