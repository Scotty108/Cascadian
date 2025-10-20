"use client"

import type React from "react"
import { SettingsSection } from "../shared/settings-section"
import { SettingsToggle } from "../shared/settings-toggle"
import { PasswordSection } from "./password-section"
import { TwoFactorSection } from "./two-factor-section"
import { ApiKeysSection } from "./api-keys-section"
import { ActiveSessionsSection } from "./active-sessions-section"
import { LoginHistorySection } from "./login-history-section"
import type { SecuritySettings, ApiKey, Session, LoginHistory } from "../../types"

interface SecurityTabProps {
  security: SecuritySettings
  apiKeys: ApiKey[]
  sessions: Session[]
  loginHistory: LoginHistory[]
  onSecurityChange: (updates: Partial<SecuritySettings>) => void
  onApiKeysChange: (apiKeys: ApiKey[]) => void
  onSessionsChange: (sessions: Session[]) => void
}

export const SecurityTab: React.FC<SecurityTabProps> = ({
  security,
  apiKeys,
  sessions,
  loginHistory,
  onSecurityChange,
  onApiKeysChange,
  onSessionsChange,
}) => {
  return (
    <div className="space-y-6">
      <SettingsSection title="Password" description="Change your account password">
        <PasswordSection />
      </SettingsSection>

      <SettingsSection
        title="Two-Factor Authentication"
        description="Secure your account with an additional verification step"
      >
        <TwoFactorSection
          isEnabled={security.twoFactorEnabled}
          onToggle={(enabled) => onSecurityChange({ twoFactorEnabled: enabled })}
        />
      </SettingsSection>

      <SettingsSection title="Security Notifications" description="Get notified about important security events">
        <div className="space-y-4">
          <SettingsToggle
            id="emailNotifications"
            label="Email Notifications"
            description="Receive security alerts via email"
            checked={security.emailNotifications}
            onCheckedChange={(checked) => onSecurityChange({ emailNotifications: checked })}
          />

          <SettingsToggle
            id="smsNotifications"
            label="SMS Notifications"
            description="Receive critical security alerts via SMS"
            checked={security.smsNotifications}
            onCheckedChange={(checked) => onSecurityChange({ smsNotifications: checked })}
          />

          <SettingsToggle
            id="loginAlerts"
            label="Login Alerts"
            description="Get notified of new device logins"
            checked={security.loginAlerts}
            onCheckedChange={(checked) => onSecurityChange({ loginAlerts: checked })}
          />
        </div>
      </SettingsSection>

      <SettingsSection title="API Access" description="Manage API keys for programmatic access">
        <ApiKeysSection apiKeys={apiKeys} onApiKeysChange={onApiKeysChange} />
      </SettingsSection>

      <SettingsSection title="Active Sessions" description="Monitor and manage your active login sessions">
        <ActiveSessionsSection sessions={sessions} onSessionsChange={onSessionsChange} />
      </SettingsSection>

      <SettingsSection title="Login History" description="Review recent login attempts and security events">
        <LoginHistorySection loginHistory={loginHistory} />
      </SettingsSection>
    </div>
  )
}
