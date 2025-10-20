"use client"

import type React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SettingsToggle } from "../shared/settings-toggle"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Bot, Shield, Activity, Bell } from "lucide-react"
import type { BotSettings } from "../../types"
import { TRADING_PAIRS } from "../../constants"

interface BotsTabProps {
  bots: BotSettings
  onBotsChange: (updates: Partial<BotSettings>) => void
}

export const BotsTab: React.FC<BotsTabProps> = ({ bots, onBotsChange }) => {
  const handleDefaultsChange = (key: keyof BotSettings["defaultParameters"], value: any) => {
    onBotsChange({
      defaultParameters: { ...bots.defaultParameters, [key]: value },
    })
  }

  const handleRiskChange = (key: keyof BotSettings["riskManagement"], value: any) => {
    onBotsChange({
      riskManagement: { ...bots.riskManagement, [key]: value },
    })
  }

  const handleBehaviorChange = (key: keyof BotSettings["behavior"], value: boolean) => {
    onBotsChange({
      behavior: { ...bots.behavior, [key]: value },
    })
  }

  const handleMonitoringChange = (key: keyof BotSettings["monitoring"], value: boolean) => {
    onBotsChange({
      monitoring: { ...bots.monitoring, [key]: value },
    })
  }

  const toggleTradingPair = (pair: string) => {
    const pairs = bots.defaultParameters.tradingPairs.includes(pair)
      ? bots.defaultParameters.tradingPairs.filter((p) => p !== pair)
      : [...bots.defaultParameters.tradingPairs, pair]
    handleDefaultsChange("tradingPairs", pairs)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Bot Settings</h2>
        <p className="text-muted-foreground">Configure default parameters and behavior for your trading bots</p>
      </div>

      {/* Default Parameters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Bot className="h-5 w-5" />
            <span>Default Parameters</span>
          </CardTitle>
          <CardDescription>Set default values for new trading bots</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="max-investment">Max Investment ($)</Label>
              <Input
                id="max-investment"
                type="number"
                value={bots.defaultParameters.maxInvestment}
                onChange={(e) => handleDefaultsChange("maxInvestment", Number(e.target.value))}
                placeholder="1000"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="risk-level">Risk Level</Label>
              <select
                id="risk-level"
                value={bots.defaultParameters.riskLevel}
                onChange={(e) => handleDefaultsChange("riskLevel", e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="low">Low Risk</option>
                <option value="medium">Medium Risk</option>
                <option value="high">High Risk</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="stop-loss">Default Stop Loss (%)</Label>
              <Input
                id="stop-loss"
                type="number"
                value={bots.defaultParameters.stopLoss}
                onChange={(e) => handleDefaultsChange("stopLoss", Number(e.target.value))}
                placeholder="5"
                min="0"
                max="100"
                step="0.1"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="take-profit">Default Take Profit (%)</Label>
              <Input
                id="take-profit"
                type="number"
                value={bots.defaultParameters.takeProfit}
                onChange={(e) => handleDefaultsChange("takeProfit", Number(e.target.value))}
                placeholder="10"
                min="0"
                max="1000"
                step="0.1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Default Trading Pairs</Label>
            <div className="flex flex-wrap gap-2">
              {TRADING_PAIRS.map((pair) => (
                <Badge
                  key={pair}
                  variant={bots.defaultParameters.tradingPairs.includes(pair) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => toggleTradingPair(pair)}
                >
                  {pair}
                </Badge>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Click pairs to add/remove them from default bot configuration
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Risk Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Shield className="h-5 w-5" />
            <span>Risk Management</span>
          </CardTitle>
          <CardDescription>Global risk controls for all bots</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="max-concurrent">Max Concurrent Bots</Label>
              <Input
                id="max-concurrent"
                type="number"
                value={bots.riskManagement.maxConcurrentBots}
                onChange={(e) => handleRiskChange("maxConcurrentBots", Number(e.target.value))}
                placeholder="3"
                min="1"
                max="20"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="max-daily-trades">Max Daily Trades</Label>
              <Input
                id="max-daily-trades"
                type="number"
                value={bots.riskManagement.maxDailyTrades}
                onChange={(e) => handleRiskChange("maxDailyTrades", Number(e.target.value))}
                placeholder="50"
                min="1"
                max="1000"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="drawdown-limit">Drawdown Limit (%)</Label>
              <Input
                id="drawdown-limit"
                type="number"
                value={bots.riskManagement.drawdownLimit}
                onChange={(e) => handleRiskChange("drawdownLimit", Number(e.target.value))}
                placeholder="20"
                min="1"
                max="100"
                step="0.1"
              />
            </div>
          </div>

          <SettingsToggle
            id="emergency-stop"
            label="Emergency Stop"
            description="Automatically stop all bots if total losses exceed limits"
            checked={bots.riskManagement.emergencyStop}
            onCheckedChange={(checked) => handleRiskChange("emergencyStop", checked)}
          />
        </CardContent>
      </Card>

      {/* Bot Behavior */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Activity className="h-5 w-5" />
            <span>Bot Behavior</span>
          </CardTitle>
          <CardDescription>Configure how bots behave in different situations</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="auto-start"
            label="Auto Start New Bots"
            description="Automatically start bots after creation"
            checked={bots.behavior.autoStart}
            onCheckedChange={(checked) => handleBehaviorChange("autoStart", checked)}
          />

          <SettingsToggle
            id="auto-restart"
            label="Auto Restart on Error"
            description="Automatically restart bots after recoverable errors"
            checked={bots.behavior.autoRestart}
            onCheckedChange={(checked) => handleBehaviorChange("autoRestart", checked)}
          />

          <SettingsToggle
            id="pause-on-loss"
            label="Pause on Consecutive Losses"
            description="Pause bot trading after multiple consecutive losses"
            checked={bots.behavior.pauseOnLoss}
            onCheckedChange={(checked) => handleBehaviorChange("pauseOnLoss", checked)}
          />

          <SettingsToggle
            id="adaptive-parameters"
            label="Adaptive Parameters"
            description="Allow bots to adjust parameters based on market conditions"
            checked={bots.behavior.adaptiveParameters}
            onCheckedChange={(checked) => handleBehaviorChange("adaptiveParameters", checked)}
          />
        </CardContent>
      </Card>

      {/* Monitoring & Alerts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Bell className="h-5 w-5" />
            <span>Monitoring & Alerts</span>
          </CardTitle>
          <CardDescription>Configure bot monitoring and notification preferences</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="performance-alerts"
            label="Performance Alerts"
            description="Get notified about significant performance changes"
            checked={bots.monitoring.performanceAlerts}
            onCheckedChange={(checked) => handleMonitoringChange("performanceAlerts", checked)}
          />

          <SettingsToggle
            id="error-notifications"
            label="Error Notifications"
            description="Receive immediate notifications for bot errors"
            checked={bots.monitoring.errorNotifications}
            onCheckedChange={(checked) => handleMonitoringChange("errorNotifications", checked)}
          />

          <SettingsToggle
            id="daily-reports"
            label="Daily Reports"
            description="Receive daily performance summaries for all bots"
            checked={bots.monitoring.dailyReports}
            onCheckedChange={(checked) => handleMonitoringChange("dailyReports", checked)}
          />

          <SettingsToggle
            id="weekly-analysis"
            label="Weekly Analysis"
            description="Get detailed weekly performance analysis and recommendations"
            checked={bots.monitoring.weeklyAnalysis}
            onCheckedChange={(checked) => handleMonitoringChange("weeklyAnalysis", checked)}
          />
        </CardContent>
      </Card>

      {/* Bot Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Configuration Summary</CardTitle>
          <CardDescription>Overview of your current bot settings</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">${bots.defaultParameters.maxInvestment}</div>
              <div className="text-sm text-muted-foreground">Max Investment</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{bots.riskManagement.maxConcurrentBots}</div>
              <div className="text-sm text-muted-foreground">Max Bots</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">{bots.defaultParameters.tradingPairs.length}</div>
              <div className="text-sm text-muted-foreground">Trading Pairs</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {bots.defaultParameters.riskLevel.charAt(0).toUpperCase() + bots.defaultParameters.riskLevel.slice(1)}
              </div>
              <div className="text-sm text-muted-foreground">Risk Level</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
