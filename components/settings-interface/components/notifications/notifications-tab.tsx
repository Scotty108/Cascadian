"use client"

import type React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SettingsToggle } from "../shared/settings-toggle"
import { Bell, Mail, MessageSquare, Smartphone } from "lucide-react"
import type { NotificationSettings } from "../../types"

interface NotificationsTabProps {
  notifications: NotificationSettings
  onNotificationsChange: (updates: Partial<NotificationSettings>) => void
}

export const NotificationsTab: React.FC<NotificationsTabProps> = ({ notifications, onNotificationsChange }) => {
  const handleEmailChange = (key: keyof NotificationSettings["email"], value: boolean) => {
    onNotificationsChange({
      email: { ...notifications.email, [key]: value },
    })
  }

  const handlePushChange = (key: keyof NotificationSettings["push"], value: boolean) => {
    onNotificationsChange({
      push: { ...notifications.push, [key]: value },
    })
  }

  const handleSmsChange = (key: keyof NotificationSettings["sms"], value: boolean) => {
    onNotificationsChange({
      sms: { ...notifications.sms, [key]: value },
    })
  }

  const handleInAppChange = (key: keyof NotificationSettings["inApp"], value: boolean) => {
    onNotificationsChange({
      inApp: { ...notifications.inApp, [key]: value },
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Notification Settings</h2>
        <p className="text-muted-foreground">Manage how you receive notifications and alerts</p>
      </div>

      {/* Email Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Mail className="h-5 w-5" />
            <span>Email Notifications</span>
          </CardTitle>
          <CardDescription>Choose which email notifications you want to receive</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="email-trading"
            label="Trading Alerts"
            description="Get notified about trade executions, order fills, and market movements"
            checked={notifications.email.trading}
            onCheckedChange={(checked) => handleEmailChange("trading", checked)}
          />
          <SettingsToggle
            id="email-bots"
            label="Bot Notifications"
            description="Receive updates about bot performance, errors, and status changes"
            checked={notifications.email.bots}
            onCheckedChange={(checked) => handleEmailChange("bots", checked)}
          />
          <SettingsToggle
            id="email-account"
            label="Account Updates"
            description="Important account changes, security alerts, and system updates"
            checked={notifications.email.account}
            onCheckedChange={(checked) => handleEmailChange("account", checked)}
          />
          <SettingsToggle
            id="email-security"
            label="Security Alerts"
            description="Login attempts, password changes, and security-related notifications"
            checked={notifications.email.security}
            onCheckedChange={(checked) => handleEmailChange("security", checked)}
          />
          <SettingsToggle
            id="email-marketing"
            label="Marketing & Promotions"
            description="Product updates, feature announcements, and promotional offers"
            checked={notifications.email.marketing}
            onCheckedChange={(checked) => handleEmailChange("marketing", checked)}
          />
        </CardContent>
      </Card>

      {/* Push Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Bell className="h-5 w-5" />
            <span>Push Notifications</span>
          </CardTitle>
          <CardDescription>Instant notifications sent to your browser or mobile device</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="push-trading"
            label="Trading Alerts"
            description="Real-time notifications for trade executions and market alerts"
            checked={notifications.push.trading}
            onCheckedChange={(checked) => handlePushChange("trading", checked)}
          />
          <SettingsToggle
            id="push-bots"
            label="Bot Alerts"
            description="Immediate notifications for bot status changes and errors"
            checked={notifications.push.bots}
            onCheckedChange={(checked) => handlePushChange("bots", checked)}
          />
          <SettingsToggle
            id="push-account"
            label="Account Alerts"
            description="Critical account notifications and security alerts"
            checked={notifications.push.account}
            onCheckedChange={(checked) => handlePushChange("account", checked)}
          />
          <SettingsToggle
            id="push-price"
            label="Price Alerts"
            description="Notifications when your price targets are reached"
            checked={notifications.push.priceAlerts}
            onCheckedChange={(checked) => handlePushChange("priceAlerts", checked)}
          />
        </CardContent>
      </Card>

      {/* SMS Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Smartphone className="h-5 w-5" />
            <span>SMS Notifications</span>
          </CardTitle>
          <CardDescription>Text message notifications for critical alerts</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="sms-security"
            label="Security Alerts"
            description="Critical security notifications via SMS"
            checked={notifications.sms.security}
            onCheckedChange={(checked) => handleSmsChange("security", checked)}
          />
          <SettingsToggle
            id="sms-critical"
            label="Critical Alerts"
            description="Emergency notifications and system-critical alerts"
            checked={notifications.sms.criticalAlerts}
            onCheckedChange={(checked) => handleSmsChange("criticalAlerts", checked)}
          />
        </CardContent>
      </Card>

      {/* In-App Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <MessageSquare className="h-5 w-5" />
            <span>In-App Notifications</span>
          </CardTitle>
          <CardDescription>Notifications displayed within the application</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="inapp-all"
            label="All Notifications"
            description="Show all notifications in the app notification center"
            checked={notifications.inApp.all}
            onCheckedChange={(checked) => handleInAppChange("all", checked)}
          />
          <SettingsToggle
            id="inapp-trading"
            label="Trading Notifications"
            description="Show trading-related notifications in the app"
            checked={notifications.inApp.trading}
            onCheckedChange={(checked) => handleInAppChange("trading", checked)}
          />
          <SettingsToggle
            id="inapp-bots"
            label="Bot Notifications"
            description="Show bot-related notifications in the app"
            checked={notifications.inApp.bots}
            onCheckedChange={(checked) => handleInAppChange("bots", checked)}
          />
          <SettingsToggle
            id="inapp-system"
            label="System Notifications"
            description="Show system updates and maintenance notifications"
            checked={notifications.inApp.system}
            onCheckedChange={(checked) => handleInAppChange("system", checked)}
          />
        </CardContent>
      </Card>

      {/* Notification Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Notification Summary</CardTitle>
          <CardDescription>Overview of your current notification preferences</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {Object.values(notifications.email).filter(Boolean).length}
              </div>
              <div className="text-sm text-muted-foreground">Email Types</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {Object.values(notifications.push).filter(Boolean).length}
              </div>
              <div className="text-sm text-muted-foreground">Push Types</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">
                {Object.values(notifications.sms).filter(Boolean).length}
              </div>
              <div className="text-sm text-muted-foreground">SMS Types</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {Object.values(notifications.inApp).filter(Boolean).length}
              </div>
              <div className="text-sm text-muted-foreground">In-App Types</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
