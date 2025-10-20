"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Save, X, Settings, Bell, Shield, Zap } from "lucide-react"
import type { DcaSettings } from "../../types"
import { mockExchanges, mockFrequencies } from "../../data"
import { formatCurrency } from "../../utils"

interface SettingsModalProps {
  isOpen: boolean
  settings: DcaSettings
  onClose: () => void
  onUpdateSettings: (updates: Partial<DcaSettings>) => void
}

export function SettingsModal({ isOpen, settings, onClose, onUpdateSettings }: SettingsModalProps) {
  const [localSettings, setLocalSettings] = useState<DcaSettings>(settings)
  const [hasChanges, setHasChanges] = useState(false)

  const handleSettingChange = (key: keyof DcaSettings, value: any) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }))
    setHasChanges(true)
  }

  const handleSave = () => {
    onUpdateSettings(localSettings)
    setHasChanges(false)
    onClose()
  }

  const handleClose = () => {
    if (hasChanges) {
      if (confirm("You have unsaved changes. Are you sure you want to close?")) {
        setLocalSettings(settings)
        setHasChanges(false)
        onClose()
      }
    } else {
      onClose()
    }
  }

  const handleReset = () => {
    if (confirm("Are you sure you want to reset all settings to default?")) {
      const defaultSettings: DcaSettings = {
        autoStart: true,
        defaultExchange: "binance",
        defaultFrequency: "daily",
        defaultAmount: 50,
        emailNotifications: true,
        pushNotifications: false,
        telegramNotifications: false,
        weeklySummary: true,
        maxDailySpend: 500,
        confirmation: false,
        twoFactor: true,
      }
      setLocalSettings(defaultSettings)
      setHasChanges(true)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            DCA Bot Settings
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {hasChanges && (
            <Alert>
              <AlertDescription>You have unsaved changes. Don&apos;t forget to save your settings.</AlertDescription>
            </Alert>
          )}

          {/* Default Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Default Bot Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="defaultExchange">Default Exchange</Label>
                  <Select
                    value={localSettings.defaultExchange}
                    onValueChange={(value) => handleSettingChange("defaultExchange", value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {mockExchanges.map((exchange) => (
                        <SelectItem key={exchange.id} value={exchange.id}>
                          {exchange.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="defaultFrequency">Default Frequency</Label>
                  <Select
                    value={localSettings.defaultFrequency}
                    onValueChange={(value) => handleSettingChange("defaultFrequency", value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {mockFrequencies.map((freq) => (
                        <SelectItem key={freq.id} value={freq.id}>
                          {freq.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="defaultAmount">Default Amount (USD)</Label>
                  <Input
                    id="defaultAmount"
                    type="number"
                    value={localSettings.defaultAmount}
                    onChange={(e) => handleSettingChange("defaultAmount", Number.parseFloat(e.target.value) || 0)}
                    min="1"
                    max="10000"
                    step="0.01"
                  />
                  <p className="text-sm text-muted-foreground">{formatCurrency(localSettings.defaultAmount)}</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="maxDailySpend">Max Daily Spend (USD)</Label>
                  <Input
                    id="maxDailySpend"
                    type="number"
                    value={localSettings.maxDailySpend}
                    onChange={(e) => handleSettingChange("maxDailySpend", Number.parseFloat(e.target.value) || 0)}
                    min="1"
                    max="50000"
                    step="0.01"
                  />
                  <p className="text-sm text-muted-foreground">{formatCurrency(localSettings.maxDailySpend)}</p>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Auto-start New Bots</Label>
                  <p className="text-sm text-muted-foreground">Automatically start new bots after creation</p>
                </div>
                <Switch
                  checked={localSettings.autoStart}
                  onCheckedChange={(checked) => handleSettingChange("autoStart", checked)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Notification Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-4 w-4" />
                Notification Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Email Notifications</Label>
                  <p className="text-sm text-muted-foreground">Receive email notifications for bot activities</p>
                </div>
                <Switch
                  checked={localSettings.emailNotifications}
                  onCheckedChange={(checked) => handleSettingChange("emailNotifications", checked)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Push Notifications</Label>
                  <p className="text-sm text-muted-foreground">Receive push notifications on your device</p>
                </div>
                <Switch
                  checked={localSettings.pushNotifications}
                  onCheckedChange={(checked) => handleSettingChange("pushNotifications", checked)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Telegram Notifications</Label>
                  <p className="text-sm text-muted-foreground">Receive notifications via Telegram bot</p>
                </div>
                <Switch
                  checked={localSettings.telegramNotifications}
                  onCheckedChange={(checked) => handleSettingChange("telegramNotifications", checked)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Weekly Summary</Label>
                  <p className="text-sm text-muted-foreground">Receive weekly performance summaries</p>
                </div>
                <Switch
                  checked={localSettings.weeklySummary}
                  onCheckedChange={(checked) => handleSettingChange("weeklySummary", checked)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Security Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Security Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Trade Confirmation</Label>
                  <p className="text-sm text-muted-foreground">Require confirmation before executing trades</p>
                </div>
                <Switch
                  checked={localSettings.confirmation}
                  onCheckedChange={(checked) => handleSettingChange("confirmation", checked)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Two-Factor Authentication</Label>
                  <p className="text-sm text-muted-foreground">Enable 2FA for additional security</p>
                </div>
                <Switch
                  checked={localSettings.twoFactor}
                  onCheckedChange={(checked) => handleSettingChange("twoFactor", checked)}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-between pt-4 gap-3 flex-wrap">
          <Button variant="outline" onClick={handleReset}>
            Reset to Defaults
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose}>
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!hasChanges}>
              <Save className="h-4 w-4 mr-2" />
              Save Settings
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
