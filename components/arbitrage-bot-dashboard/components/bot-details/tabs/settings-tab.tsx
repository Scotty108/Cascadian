"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Save, RotateCcw, Info, AlertCircle, CheckCircle, Loader2 } from "lucide-react"
import type { ArbitrageBot } from "../../../types"

interface SettingsTabProps {
  bot: ArbitrageBot
}

interface BotSettings {
  name: string
  minSpread: number
  maxVolume: number
  profitThreshold: number
  executionSpeed: string
  slippageTolerance: number
  gasPrice: string
  maxConcurrentTrades: number
  autoRebalance: boolean
  rebalanceThreshold: number
  autoExecute: boolean
  notifications: boolean
  stopLoss: boolean
  stopLossPercentage: number
  takeProfit: boolean
  takeProfitPercentage: number
}

export function SettingsTab({ bot }: SettingsTabProps) {
  const [settings, setSettings] = useState<BotSettings>({
    name: bot.name,
    minSpread: bot.minSpread,
    maxVolume: bot.maxVolume,
    profitThreshold: bot.profitThreshold,
    executionSpeed: bot.settings?.executionSpeed || "normal",
    slippageTolerance: bot.settings?.slippageTolerance || 0.2,
    gasPrice: bot.settings?.gasPrice || "medium",
    maxConcurrentTrades: bot.settings?.maxConcurrentTrades || 3,
    autoRebalance: bot.settings?.autoRebalance || false,
    rebalanceThreshold: bot.settings?.rebalanceThreshold || 10,
    autoExecute: true,
    notifications: true,
    stopLoss: false,
    stopLossPercentage: 5,
    takeProfit: false,
    takeProfitPercentage: 10,
  })

  const [originalSettings, setOriginalSettings] = useState<BotSettings>(settings)
  const [isLoading, setIsLoading] = useState(false)
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle")
  const [errors, setErrors] = useState<Record<string, string>>({})

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(originalSettings)

  const validateSettings = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!settings.name.trim()) {
      newErrors.name = "Bot name is required"
    }

    if (settings.minSpread < 0.1 || settings.minSpread > 10) {
      newErrors.minSpread = "Min spread must be between 0.1% and 10%"
    }

    if (settings.maxVolume < 100 || settings.maxVolume > 1000000) {
      newErrors.maxVolume = "Max volume must be between $100 and $1,000,000"
    }

    if (settings.profitThreshold < 0.01 || settings.profitThreshold > 100) {
      newErrors.profitThreshold = "Profit threshold must be between $0.01 and $100"
    }

    if (settings.slippageTolerance < 0.1 || settings.slippageTolerance > 5) {
      newErrors.slippageTolerance = "Slippage tolerance must be between 0.1% and 5%"
    }

    if (settings.maxConcurrentTrades < 1 || settings.maxConcurrentTrades > 10) {
      newErrors.maxConcurrentTrades = "Max concurrent trades must be between 1 and 10"
    }

    if (settings.rebalanceThreshold < 1 || settings.rebalanceThreshold > 50) {
      newErrors.rebalanceThreshold = "Rebalance threshold must be between 1% and 50%"
    }

    if (settings.stopLoss && (settings.stopLossPercentage < 1 || settings.stopLossPercentage > 20)) {
      newErrors.stopLossPercentage = "Stop loss must be between 1% and 20%"
    }

    if (settings.takeProfit && (settings.takeProfitPercentage < 1 || settings.takeProfitPercentage > 50)) {
      newErrors.takeProfitPercentage = "Take profit must be between 1% and 50%"
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSave = async () => {
    if (!validateSettings()) return

    setIsLoading(true)
    setSaveStatus("idle")

    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))

      setOriginalSettings(settings)
      setSaveStatus("success")

      // Clear success message after 3 seconds
      setTimeout(() => setSaveStatus("idle"), 3000)
    } catch (error) {
      setSaveStatus("error")
    } finally {
      setIsLoading(false)
    }
  }

  const handleReset = () => {
    setSettings(originalSettings)
    setErrors({})
    setSaveStatus("idle")
  }

  const updateSetting = <K extends keyof BotSettings>(key: K, value: BotSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    if (errors[key]) {
      setErrors((prev) => ({ ...prev, [key]: "" }))
    }
  }

  return (
    <div className="space-y-6">
      {/* Save Status */}
      {saveStatus === "success" && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>Settings saved successfully!</AlertDescription>
        </Alert>
      )}

      {saveStatus === "error" && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Failed to save settings. Please try again.</AlertDescription>
        </Alert>
      )}

      {/* Basic Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Basic Settings</CardTitle>
          <CardDescription>Configure the fundamental parameters for your arbitrage bot</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="bot-name">Bot Name</Label>
              <Input
                id="bot-name"
                value={settings.name}
                onChange={(e) => updateSetting("name", e.target.value)}
                className={errors.name ? "border-red-500" : ""}
              />
              {errors.name && <p className="text-sm text-red-500">{errors.name}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="min-spread">Minimum Spread (%)</Label>
              <div className="flex items-center space-x-2">
                <Input
                  id="min-spread"
                  type="number"
                  value={settings.minSpread}
                  onChange={(e) => updateSetting("minSpread", Number.parseFloat(e.target.value) || 0)}
                  min="0.1"
                  max="10"
                  step="0.1"
                  className={errors.minSpread ? "border-red-500" : ""}
                />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Info className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs text-sm">
                        Minimum price difference between exchanges to consider an opportunity
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              {errors.minSpread && <p className="text-sm text-red-500">{errors.minSpread}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="max-volume">Maximum Volume ($)</Label>
              <Input
                id="max-volume"
                type="number"
                value={settings.maxVolume}
                onChange={(e) => updateSetting("maxVolume", Number.parseFloat(e.target.value) || 0)}
                min="100"
                max="1000000"
                step="100"
                className={errors.maxVolume ? "border-red-500" : ""}
              />
              {errors.maxVolume && <p className="text-sm text-red-500">{errors.maxVolume}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="profit-threshold">Profit Threshold ($)</Label>
              <Input
                id="profit-threshold"
                type="number"
                value={settings.profitThreshold}
                onChange={(e) => updateSetting("profitThreshold", Number.parseFloat(e.target.value) || 0)}
                min="0.01"
                max="100"
                step="0.01"
                className={errors.profitThreshold ? "border-red-500" : ""}
              />
              {errors.profitThreshold && <p className="text-sm text-red-500">{errors.profitThreshold}</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Execution Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Execution Settings</CardTitle>
          <CardDescription>Configure how trades are executed</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="execution-speed">Execution Speed</Label>
              <Select value={settings.executionSpeed} onValueChange={(value) => updateSetting("executionSpeed", value)}>
                <SelectTrigger id="execution-speed">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="slow">Slow (Lower Fees)</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="fast">Fast (Higher Fees)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="gas-price">Gas Price</Label>
              <Select value={settings.gasPrice} onValueChange={(value) => updateSetting("gasPrice", value)}>
                <SelectTrigger id="gas-price">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="slippage-tolerance">Slippage Tolerance (%)</Label>
              <Input
                id="slippage-tolerance"
                type="number"
                value={settings.slippageTolerance}
                onChange={(e) => updateSetting("slippageTolerance", Number.parseFloat(e.target.value) || 0)}
                min="0.1"
                max="5"
                step="0.1"
                className={errors.slippageTolerance ? "border-red-500" : ""}
              />
              {errors.slippageTolerance && <p className="text-sm text-red-500">{errors.slippageTolerance}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="max-concurrent">Max Concurrent Trades</Label>
              <Input
                id="max-concurrent"
                type="number"
                value={settings.maxConcurrentTrades}
                onChange={(e) => updateSetting("maxConcurrentTrades", Number.parseInt(e.target.value) || 0)}
                min="1"
                max="10"
                className={errors.maxConcurrentTrades ? "border-red-500" : ""}
              />
              {errors.maxConcurrentTrades && <p className="text-sm text-red-500">{errors.maxConcurrentTrades}</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Risk Management */}
      <Card>
        <CardHeader>
          <CardTitle>Risk Management</CardTitle>
          <CardDescription>Configure risk management and safety features</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Auto Rebalance</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically rebalance portfolio when threshold is reached
                </p>
              </div>
              <Switch
                checked={settings.autoRebalance}
                onCheckedChange={(checked) => updateSetting("autoRebalance", checked)}
              />
            </div>

            {settings.autoRebalance && (
              <div className="space-y-2">
                <Label htmlFor="rebalance-threshold">Rebalance Threshold (%)</Label>
                <Input
                  id="rebalance-threshold"
                  type="number"
                  value={settings.rebalanceThreshold}
                  onChange={(e) => updateSetting("rebalanceThreshold", Number.parseFloat(e.target.value) || 0)}
                  min="1"
                  max="50"
                  className={errors.rebalanceThreshold ? "border-red-500" : ""}
                />
                {errors.rebalanceThreshold && <p className="text-sm text-red-500">{errors.rebalanceThreshold}</p>}
              </div>
            )}

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Stop Loss</Label>
                <p className="text-xs text-muted-foreground">Automatically stop trading when losses exceed threshold</p>
              </div>
              <Switch checked={settings.stopLoss} onCheckedChange={(checked) => updateSetting("stopLoss", checked)} />
            </div>

            {settings.stopLoss && (
              <div className="space-y-2">
                <Label htmlFor="stop-loss-percentage">Stop Loss Percentage (%)</Label>
                <Input
                  id="stop-loss-percentage"
                  type="number"
                  value={settings.stopLossPercentage}
                  onChange={(e) => updateSetting("stopLossPercentage", Number.parseFloat(e.target.value) || 0)}
                  min="1"
                  max="20"
                  className={errors.stopLossPercentage ? "border-red-500" : ""}
                />
                {errors.stopLossPercentage && <p className="text-sm text-red-500">{errors.stopLossPercentage}</p>}
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Take Profit</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically stop trading when profit target is reached
                </p>
              </div>
              <Switch
                checked={settings.takeProfit}
                onCheckedChange={(checked) => updateSetting("takeProfit", checked)}
              />
            </div>

            {settings.takeProfit && (
              <div className="space-y-2">
                <Label htmlFor="take-profit-percentage">Take Profit Percentage (%)</Label>
                <Input
                  id="take-profit-percentage"
                  type="number"
                  value={settings.takeProfitPercentage}
                  onChange={(e) => updateSetting("takeProfitPercentage", Number.parseFloat(e.target.value) || 0)}
                  min="1"
                  max="50"
                  className={errors.takeProfitPercentage ? "border-red-500" : ""}
                />
                {errors.takeProfitPercentage && <p className="text-sm text-red-500">{errors.takeProfitPercentage}</p>}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Automation Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Automation & Notifications</CardTitle>
          <CardDescription>Configure automation and notification preferences</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Auto Execute Trades</Label>
              <p className="text-xs text-muted-foreground">Automatically execute profitable arbitrage opportunities</p>
            </div>
            <Switch
              checked={settings.autoExecute}
              onCheckedChange={(checked) => updateSetting("autoExecute", checked)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Notifications</Label>
              <p className="text-xs text-muted-foreground">Receive notifications for trades and important events</p>
            </div>
            <Switch
              checked={settings.notifications}
              onCheckedChange={(checked) => updateSetting("notifications", checked)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {hasChanges && (
            <Badge variant="outline" className="text-yellow-600">
              Unsaved Changes
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleReset} disabled={!hasChanges || isLoading}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges || isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Save className="mr-2 h-4 w-4" />
            Save Settings
          </Button>
        </div>
      </div>
    </div>
  )
}
