import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { SettingsToggle } from "./settings-toggle"
import type { ReferralSettings } from "../types"

interface ReferralSettingsCardProps {
  settings: ReferralSettings
  onSettingsChange: (settings: Partial<ReferralSettings>) => void
}

export function ReferralSettingsCard({ settings, onSettingsChange }: ReferralSettingsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Referral Settings</CardTitle>
        <CardDescription>Customize your referral program preferences</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SettingsToggle
          title="Email Notifications"
          description="Receive email notifications when someone joins using your referral link"
          checked={settings.emailNotifications}
          onCheckedChange={(checked) => onSettingsChange({ emailNotifications: checked })}
        />
        <Separator />
        <SettingsToggle
          title="Show in Leaderboard"
          description="Allow your name and referral count to be displayed on the public leaderboard"
          checked={settings.showInLeaderboard}
          onCheckedChange={(checked) => onSettingsChange({ showInLeaderboard: checked })}
        />
        <Separator />
        <SettingsToggle
          title="Auto-share Achievements"
          description="Automatically share when you reach new referral milestones"
          checked={settings.autoShareAchievements}
          onCheckedChange={(checked) => onSettingsChange({ autoShareAchievements: checked })}
        />
      </CardContent>
    </Card>
  )
}
