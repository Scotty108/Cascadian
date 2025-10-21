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
  accessibility: {
    highContrast: boolean
    reducedMotion: boolean
    largeText: boolean
    screenReader: boolean
  }
}

// Removed: TradingSettings, BotSettings, WhaleActivitySettings, InsiderDetectionSettings, PrivacySettings
// These are not needed for CASCADIAN (Polymarket analytics platform)

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
