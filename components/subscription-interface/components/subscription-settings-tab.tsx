import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import type { SubscriptionSettings } from "../types"
import { SettingsToggleItem } from "./settings-toggle-item"

interface SubscriptionSettingsTabProps {
  settings: SubscriptionSettings
  onUpdateSetting: (key: keyof SubscriptionSettings, value: boolean) => void
}

export function SubscriptionSettingsTab({ settings, onUpdateSetting }: SubscriptionSettingsTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Subscription Settings</CardTitle>
        <CardDescription>Manage your subscription preferences</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <SettingsToggleItem
          id="auto-renew"
          label="Auto-renew subscription"
          description="Automatically renew your subscription when it expires"
          checked={settings.autoRenew}
          onCheckedChange={(checked) => onUpdateSetting("autoRenew", checked)}
        />
        <Separator />
        <SettingsToggleItem
          id="email-notifications"
          label="Email notifications"
          description="Receive email notifications about your subscription"
          checked={settings.emailNotifications}
          onCheckedChange={(checked) => onUpdateSetting("emailNotifications", checked)}
        />
        <Separator />
        <SettingsToggleItem
          id="renewal-reminders"
          label="Renewal reminders"
          description="Get notified before your subscription renews"
          checked={settings.renewalReminders}
          onCheckedChange={(checked) => onUpdateSetting("renewalReminders", checked)}
        />
      </CardContent>
    </Card>
  )
}
