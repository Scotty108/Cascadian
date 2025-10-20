"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Slider } from "@/components/ui/slider"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Save, RotateCcw, AlertCircle, Info, Shield, Zap, DollarSign } from "lucide-react"

interface GlobalSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (settings: GlobalSettings) => Promise<void>
}

interface GlobalSettings {
  // Risk Management
  maxDailyLoss: number
  maxConcurrentTrades: number
  emergencyStopLoss: number

  // Performance
  executionSpeed: string
  apiRateLimit: number
  maxRetries: number

  // Notifications
  emailNotifications: boolean
  pushNotifications: boolean
  discordWebhook: string
  telegramBotToken: string

  // Trading
  defaultMinSpread: number
  defaultMaxVolume: number
  autoRebalance: boolean
  pauseOnHighVolatility: boolean

  // Advanced
  enableLogging: boolean
  logLevel: string
  backupFrequency: string
  dataRetention: number
}

const defaultSettings: GlobalSettings = {
  maxDailyLoss: 1000,
  maxConcurrentTrades: 10,
  emergencyStopLoss: 5000,
  executionSpeed: "normal",
  apiRateLimit: 100,
  maxRetries: 3,
  emailNotifications: true,
  pushNotifications: true,
  discordWebhook: "",
  telegramBotToken: "",
  defaultMinSpread: 0.5,
  defaultMaxVolume: 10000,
  autoRebalance: true,
  pauseOnHighVolatility: true,
  enableLogging: true,
  logLevel: "info",
  backupFrequency: "daily",
  dataRetention: 30,
}

export function GlobalSettingsModal({ isOpen, onClose, onSave }: GlobalSettingsModalProps) {
  const [settings, setSettings] = useState<GlobalSettings>(defaultSettings)
  const [isLoading, setIsLoading] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  const updateSetting = <K extends keyof GlobalSettings>(key: K, value: GlobalSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setHasChanges(true)
  }

  const handleSave = async () => {
    setIsLoading(true)
    try {
      await onSave(settings)
      setHasChanges(false)
      onClose()
    } catch (error) {
      console.error("Failed to save settings:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleReset = () => {
    setSettings(defaultSettings)
    setHasChanges(true)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Global Settings</DialogTitle>
          <DialogDescription>Configure global settings for all arbitrage bots</DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto max-h-[calc(90vh-200px)]">
          <Tabs defaultValue="risk" className="space-y-4">
            <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
              <TabsTrigger value="risk" className="text-xs sm:text-sm">
                <Shield className="mr-1 h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Risk</span>
              </TabsTrigger>
              <TabsTrigger value="performance" className="text-xs sm:text-sm">
                <Zap className="mr-1 h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Performance</span>
              </TabsTrigger>
              <TabsTrigger value="notifications" className="text-xs sm:text-sm">
                <AlertCircle className="mr-1 h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Alerts</span>
              </TabsTrigger>
              <TabsTrigger value="trading" className="text-xs sm:text-sm">
                <DollarSign className="mr-1 h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Trading</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="risk" className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="maxDailyLoss">Max Daily Loss ($)</Label>
                  <Input
                    id="maxDailyLoss"
                    type="number"
                    value={settings.maxDailyLoss}
                    onChange={(e) => updateSetting("maxDailyLoss", Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">Stop all bots if daily loss exceeds this amount</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="maxConcurrentTrades">Max Concurrent Trades</Label>
                  <div className="space-y-2">
                    <Slider
                      value={[settings.maxConcurrentTrades]}
                      onValueChange={([value]) => updateSetting("maxConcurrentTrades", value)}
                      max={50}
                      min={1}
                      step={1}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>1</span>
                      <Badge variant="outline">{settings.maxConcurrentTrades}</Badge>
                      <span>50</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="emergencyStopLoss">Emergency Stop Loss ($)</Label>
                  <Input
                    id="emergencyStopLoss"
                    type="number"
                    value={settings.emergencyStopLoss}
                    onChange={(e) => updateSetting("emergencyStopLoss", Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">Emergency stop if total loss reaches this amount</p>
                </div>
              </div>

              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  Risk management settings apply to all bots and override individual bot settings.
                </AlertDescription>
              </Alert>
            </TabsContent>

            <TabsContent value="performance" className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="executionSpeed">Execution Speed</Label>
                  <Select
                    value={settings.executionSpeed}
                    onValueChange={(value) => updateSetting("executionSpeed", value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="slow">Slow (Lower Fees)</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="fast">Fast (Higher Fees)</SelectItem>
                      <SelectItem value="ultra">Ultra Fast (Premium)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="apiRateLimit">API Rate Limit (req/min)</Label>
                  <div className="space-y-2">
                    <Slider
                      value={[settings.apiRateLimit]}
                      onValueChange={([value]) => updateSetting("apiRateLimit", value)}
                      max={1000}
                      min={10}
                      step={10}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>10</span>
                      <Badge variant="outline">{settings.apiRateLimit}</Badge>
                      <span>1000</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="maxRetries">Max Retries</Label>
                  <Select
                    value={settings.maxRetries.toString()}
                    onValueChange={(value) => updateSetting("maxRetries", Number(value))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 Retry</SelectItem>
                      <SelectItem value="3">3 Retries</SelectItem>
                      <SelectItem value="5">5 Retries</SelectItem>
                      <SelectItem value="10">10 Retries</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="notifications" className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Email Notifications</Label>
                    <p className="text-xs text-muted-foreground">Receive email alerts for important events</p>
                  </div>
                  <Switch
                    checked={settings.emailNotifications}
                    onCheckedChange={(checked) => updateSetting("emailNotifications", checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Push Notifications</Label>
                    <p className="text-xs text-muted-foreground">Browser push notifications</p>
                  </div>
                  <Switch
                    checked={settings.pushNotifications}
                    onCheckedChange={(checked) => updateSetting("pushNotifications", checked)}
                  />
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label htmlFor="discordWebhook">Discord Webhook URL</Label>
                  <Input
                    id="discordWebhook"
                    type="url"
                    placeholder="https://discord.com/api/webhooks/..."
                    value={settings.discordWebhook}
                    onChange={(e) => updateSetting("discordWebhook", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="telegramBotToken">Telegram Bot Token</Label>
                  <Input
                    id="telegramBotToken"
                    type="password"
                    placeholder="Enter your Telegram bot token"
                    value={settings.telegramBotToken}
                    onChange={(e) => updateSetting("telegramBotToken", e.target.value)}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="trading" className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="defaultMinSpread">Default Min Spread (%)</Label>
                  <Input
                    id="defaultMinSpread"
                    type="number"
                    step="0.1"
                    value={settings.defaultMinSpread}
                    onChange={(e) => updateSetting("defaultMinSpread", Number(e.target.value))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="defaultMaxVolume">Default Max Volume ($)</Label>
                  <Input
                    id="defaultMaxVolume"
                    type="number"
                    value={settings.defaultMaxVolume}
                    onChange={(e) => updateSetting("defaultMaxVolume", Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Auto Rebalance</Label>
                    <p className="text-xs text-muted-foreground">Automatically rebalance portfolios</p>
                  </div>
                  <Switch
                    checked={settings.autoRebalance}
                    onCheckedChange={(checked) => updateSetting("autoRebalance", checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Pause on High Volatility</Label>
                    <p className="text-xs text-muted-foreground">Pause trading during high market volatility</p>
                  </div>
                  <Switch
                    checked={settings.pauseOnHighVolatility}
                    onCheckedChange={(checked) => updateSetting("pauseOnHighVolatility", checked)}
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <div className="flex flex-col sm:flex-row justify-between gap-2 pt-4 border-t">
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleReset} disabled={isLoading}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset to Defaults
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isLoading || !hasChanges}>
              <Save className="mr-2 h-4 w-4" />
              {isLoading ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
