import type {
  SettingsState,
  UserProfile,
  SecuritySettings,
  NotificationSettings,
  AppearanceSettings,
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
    markets: true,      // Market signals, SII, Momentum alerts
    whales: true,       // Whale position/trade activity
    insiders: true,     // Insider detection flags
    account: true,      // Account updates
    security: true,     // Security alerts
  },
  push: {
    markets: true,      // Real-time market alerts
    whales: true,       // Real-time whale alerts
    insiders: true,     // Real-time insider alerts
    account: true,      // Account notifications
  },
  sms: {
    security: true,     // Critical security alerts
    criticalAlerts: true, // Critical market/whale/insider alerts
  },
  inApp: {
    all: true,          // Show all in-app notifications
    markets: true,      // Market activity notifications
    whales: true,       // Whale activity notifications
    insiders: true,     // Insider detection notifications
    system: true,       // System updates
  },
}

export const defaultAppearanceSettings: AppearanceSettings = {
  theme: "system",
  density: "comfortable",
  language: "en",
  dateFormat: "MM/DD/YYYY",
  timeFormat: "12h",
  timezone: "America/New_York",
  customColors: {
    primaryAccent: "#00E0AA",
    secondaryAccent: "#FFC107",
  },
  accessibility: {
    highContrast: false,
    reducedMotion: false,
    largeText: false,
    screenReader: false,
  },
}

// Removed: defaultTradingSettings, defaultBotSettings, defaultWhaleActivitySettings, defaultInsiderDetectionSettings, defaultPrivacySettings
// These are not needed for CASCADIAN (Polymarket analytics platform)

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
  // AI Service APIs
  {
    id: "ai-1",
    name: "OpenAI API",
    type: "service",
    status: "connected",
    lastSync: "2024-01-15T10:30:00Z",
    permissions: ["read"],
    icon: "/placeholder.svg?height=32&width=32",
  },
  {
    id: "ai-2",
    name: "Anthropic API",
    type: "service",
    status: "connected",
    lastSync: "2024-01-15T10:25:00Z",
    permissions: ["read"],
    icon: "/placeholder.svg?height=32&width=32",
  },
  {
    id: "ai-3",
    name: "Google AI API",
    type: "service",
    status: "disconnected",
    lastSync: "2024-01-10T14:20:00Z",
    permissions: ["read"],
    icon: "/placeholder.svg?height=32&width=32",
  },
  // Prediction Market APIs
  {
    id: "market-1",
    name: "Polymarket API",
    type: "service",
    status: "connected",
    lastSync: "2024-01-15T10:30:00Z",
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
  data: defaultDataSettings,
  connections: mockConnections,
  apiKeys: mockApiKeys,
  sessions: mockSessions,
  loginHistory: mockLoginHistory,
  activeTab: "profile",
  isLoading: false,
  hasUnsavedChanges: false,
}
