export interface UserProfile {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string
  bio: string
  avatar: string
  location: string
  website: string
  company: string
  position: string
  experience: string
  socialProfiles: {
    twitter: string
    linkedin: string
    github: string
    telegram: string
  }
}

export interface SecuritySettings {
  twoFactorEnabled: boolean
  emailNotifications: boolean
  smsNotifications: boolean
  loginAlerts: boolean
  apiKeysEnabled: boolean
  sessionTimeout: number
}

export interface NotificationSettings {
  email: {
    markets: boolean
    whales: boolean
    insiders: boolean
    account: boolean
    security: boolean
  }
  push: {
    markets: boolean
    whales: boolean
    insiders: boolean
    account: boolean
  }
  sms: {
    security: boolean
    criticalAlerts: boolean
  }
  inApp: {
    all: boolean
    markets: boolean
    whales: boolean
    insiders: boolean
    system: boolean
  }
}

export interface AppearanceSettings {
  theme: "light" | "dark" | "system"
  density: "compact" | "comfortable" | "spacious"
  language: string
  dateFormat: string
  timeFormat: "12h" | "24h"
  timezone: string
  customColors: {
    primaryAccent: string
    secondaryAccent: string
  }
  accessibility: {
    highContrast: boolean
    reducedMotion: boolean
    largeText: boolean
    screenReader: boolean
  }
}

// Placeholder types for legacy components
export interface BotSettings {
  enabled: boolean
  defaultParameters: {
    maxPositionSize: number
    maxInvestment: number
    riskLevel: string
    tradingPairs: string[]
    stopLoss: number
    takeProfit: number
    slippageTolerance: number
  }
  riskManagement: {
    maxDailyLoss: number
    maxDrawdown: number
    stopLoss: boolean
    drawdownLimit: number
    emergencyStop: boolean
    maxConcurrentBots: number
    maxDailyTrades: number
  }
  behavior: {
    autoStart: boolean
    pauseOnErrors: boolean
    respectMarketHours: boolean
    autoRestart: boolean
    pauseOnLoss: boolean
    adaptiveParameters: boolean
  }
  monitoring: {
    logTrades: boolean
    sendAlerts: boolean
    trackPerformance: boolean
    dailyReports: boolean
    weeklyAnalysis: boolean
    errorNotifications: boolean
    performanceAlerts: boolean
  }
  notifications: {
    trades: boolean
    errors: boolean
    dailySummary: boolean
  }
}

export interface InsiderDetectionSettings {
  enabled: boolean
  sensitivity: string
  minTradeSize: number
  trackingWindow: number
  alertThreshold: number
  alertThresholds: {
    enabled: boolean
    minInsiderScore: number
    riskLevels: string[]
    alertOnStatusChange: boolean
  }
  marketWatch: {
    enabled: boolean
    minActivityScore: number
    priorityLevels: string[]
    watchedCategories: string[]
  }
  clusterDetection: {
    enabled: boolean
    minClusterSize: number
    minClusterScore: number
    connectionTypes: string[]
  }
  timingAnomalies: {
    enabled: boolean
    maxTimeToOutcome: number
    minTimingScore: number
  }
  volumeAnomalies: {
    enabled: boolean
    minZScore: number
    minVolumeScore: number
  }
  complianceSettings: {
    autoExportEnabled: boolean
    exportFrequency: string
    exportFormat: string
    includeFlags: boolean
    includeClusters: boolean
    includeMarketRiskScores: boolean
    includeInvestigationNotes: boolean
  }
  displayPreferences: {
    defaultView: string
    progressiveDisclosureLevel: number
    showAdvancedMetrics: boolean
  }
}

export interface PrivacySettings {
  dataSharing: {
    analytics: boolean
    marketing: boolean
    thirdParty: boolean
    research: boolean
  }
  profilePrivacy: {
    publicProfile: boolean
    showTradingStats: boolean
    showPortfolio: boolean
    allowMessages: boolean
  }
  cookiesTracking: {
    essential: boolean
    analytics: boolean
    marketing: boolean
    preferences: boolean
  }
  securityPrivacy: {
    loginHistory: boolean
    deviceTracking: boolean
    locationTracking: boolean
    biometricData: boolean
  }
}

export interface TradingSettings {
  defaultExchange: string
  defaultTradingPair: string
  orderDefaults: {
    orderType: string
    timeInForce: string
    postOnly: boolean
    reduceOnly: boolean
  }
  riskManagement: {
    maxPositionSize: number
    maxDailyLoss: number
    stopLossPercentage: number
    takeProfitPercentage: number
    maxOpenPositions: number
  }
  chartPreferences: {
    defaultTimeframe: string
    chartType: string
    theme: string
    indicators: string[]
  }
}

export interface WhaleActivitySettings {
  positionAlerts: {
    enabled: boolean
    minPositionSize: number
    minPnlChange: number
    minSwsScore: number
    smartWhalesOnly: boolean
    watchedCategories: string[]
  }
  tradeAlerts: {
    enabled: boolean
    minTradeSize: number
    priceImpactThreshold: number
    unusualOnly: boolean
    smartWhalesOnly: boolean
    watchedCategories: string[]
  }
  flipAlerts: {
    enabled: boolean
    minPositionSize: number
    smartWhalesOnly: boolean
  }
  flowAlerts: {
    enabled: boolean
    sentimentChange: boolean
    volumeThreshold: number
  }
  concentrationAlerts: {
    enabled: boolean
    herfindahlThreshold: number
    whaleShareThreshold: number
  }
  displayPreferences: {
    defaultTimeframe: string
    defaultSortBy: string
    refreshInterval: number
    autoRefreshEnabled: boolean
    showAdvancedMetrics: boolean
  }
}

export interface DataSettings {
  retention: {
    tradingHistory: number
    botLogs: number
    personalData: number
    analyticsData: number
  }
  export: {
    format: "json" | "csv" | "xlsx"
    includePersonalData: boolean
    includeTradingData: boolean
    includeBotData: boolean
  }
}

export interface Connection {
  id: string
  name: string
  type: "exchange" | "wallet" | "service"
  status: "connected" | "disconnected" | "error"
  lastSync: string
  permissions: string[]
  icon: string
}

export interface ApiKey {
  id: string
  name: string
  key: string
  permissions: string[]
  lastUsed: string
  created: string
  status: "active" | "inactive"
}

export interface Session {
  id: string
  device: string
  location: string
  ip: string
  lastActive: string
  current: boolean
  browser: string
  os: string
}

export interface LoginHistory {
  id: string
  timestamp: string
  ip: string
  location: string
  device: string
  success: boolean
  method: string
}

export interface SettingsTab {
  id: string
  label: string
  icon: string
  description: string
}

export interface SettingsState {
  profile: UserProfile
  security: SecuritySettings
  notifications: NotificationSettings
  appearance: AppearanceSettings
  data: DataSettings
  connections: Connection[]
  apiKeys: ApiKey[]
  sessions: Session[]
  loginHistory: LoginHistory[]
  activeTab: string
  isLoading: boolean
  hasUnsavedChanges: boolean
}
