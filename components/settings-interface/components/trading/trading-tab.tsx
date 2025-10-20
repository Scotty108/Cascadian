"use client"

import type React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SettingsSelect } from "../shared/settings-select"
import { SettingsToggle } from "../shared/settings-toggle"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { TrendingUp, Shield, BarChart3, Settings } from "lucide-react"
import type { TradingSettings } from "../../types"
import { EXCHANGES, TRADING_PAIRS, CHART_TIMEFRAMES, TECHNICAL_INDICATORS } from "../../constants"

interface TradingTabProps {
  trading: TradingSettings
  onTradingChange: (updates: Partial<TradingSettings>) => void
}

export const TradingTab: React.FC<TradingTabProps> = ({ trading, onTradingChange }) => {
  const handleDefaultsChange = (key: keyof TradingSettings["orderDefaults"], value: any) => {
    onTradingChange({
      orderDefaults: { ...trading.orderDefaults, [key]: value },
    })
  }

  const handleRiskChange = (key: keyof TradingSettings["riskManagement"], value: number) => {
    onTradingChange({
      riskManagement: { ...trading.riskManagement, [key]: value },
    })
  }

  const handleChartChange = (key: keyof TradingSettings["chartPreferences"], value: any) => {
    onTradingChange({
      chartPreferences: { ...trading.chartPreferences, [key]: value },
    })
  }

  const orderTypeOptions = [
    { value: "market", label: "Market Order" },
    { value: "limit", label: "Limit Order" },
    { value: "stop", label: "Stop Order" },
  ]

  const timeInForceOptions = [
    { value: "GTC", label: "Good Till Canceled" },
    { value: "IOC", label: "Immediate or Cancel" },
    { value: "FOK", label: "Fill or Kill" },
  ]

  const chartTypeOptions = [
    { value: "candlestick", label: "Candlestick" },
    { value: "line", label: "Line Chart" },
    { value: "area", label: "Area Chart" },
  ]

  const chartThemeOptions = [
    { value: "light", label: "Light Theme" },
    { value: "dark", label: "Dark Theme" },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Trading Settings</h2>
        <p className="text-muted-foreground">Configure your default trading preferences and risk management</p>
      </div>

      {/* Default Trading Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <TrendingUp className="h-5 w-5" />
            <span>Default Trading Settings</span>
          </CardTitle>
          <CardDescription>Set your preferred exchange and trading pair defaults</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsSelect
            id="default-exchange"
            label="Default Exchange"
            description="Your preferred exchange for trading"
            value={trading.defaultExchange}
            onValueChange={(value) => onTradingChange({ defaultExchange: value })}
            options={EXCHANGES}
          />

          <SettingsSelect
            id="default-pair"
            label="Default Trading Pair"
            description="Your preferred trading pair"
            value={trading.defaultTradingPair}
            onValueChange={(value) => onTradingChange({ defaultTradingPair: value })}
            options={TRADING_PAIRS.map((pair) => ({ value: pair, label: pair }))}
          />
        </CardContent>
      </Card>

      {/* Order Defaults */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Settings className="h-5 w-5" />
            <span>Order Defaults</span>
          </CardTitle>
          <CardDescription>Configure default order settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsSelect
            id="order-type"
            label="Default Order Type"
            description="Your preferred order type for new trades"
            value={trading.orderDefaults.orderType}
            onValueChange={(value) => handleDefaultsChange("orderType", value)}
            options={orderTypeOptions}
          />

          <SettingsSelect
            id="time-in-force"
            label="Time in Force"
            description="How long your orders remain active"
            value={trading.orderDefaults.timeInForce}
            onValueChange={(value) => handleDefaultsChange("timeInForce", value)}
            options={timeInForceOptions}
          />

          <SettingsToggle
            id="post-only"
            label="Post Only Orders"
            description="Only place orders that add liquidity to the order book"
            checked={trading.orderDefaults.postOnly}
            onCheckedChange={(checked) => handleDefaultsChange("postOnly", checked)}
          />

          <SettingsToggle
            id="reduce-only"
            label="Reduce Only Orders"
            description="Only place orders that reduce your position size"
            checked={trading.orderDefaults.reduceOnly}
            onCheckedChange={(checked) => handleDefaultsChange("reduceOnly", checked)}
          />
        </CardContent>
      </Card>

      {/* Risk Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Shield className="h-5 w-5" />
            <span>Risk Management</span>
          </CardTitle>
          <CardDescription>Set limits to protect your capital</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="max-position">Max Position Size ($)</Label>
              <Input
                id="max-position"
                type="number"
                value={trading.riskManagement.maxPositionSize}
                onChange={(e) => handleRiskChange("maxPositionSize", Number(e.target.value))}
                placeholder="10000"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="max-daily-loss">Max Daily Loss ($)</Label>
              <Input
                id="max-daily-loss"
                type="number"
                value={trading.riskManagement.maxDailyLoss}
                onChange={(e) => handleRiskChange("maxDailyLoss", Number(e.target.value))}
                placeholder="1000"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="stop-loss">Default Stop Loss (%)</Label>
              <Input
                id="stop-loss"
                type="number"
                value={trading.riskManagement.stopLossPercentage}
                onChange={(e) => handleRiskChange("stopLossPercentage", Number(e.target.value))}
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
                value={trading.riskManagement.takeProfitPercentage}
                onChange={(e) => handleRiskChange("takeProfitPercentage", Number(e.target.value))}
                placeholder="10"
                min="0"
                max="1000"
                step="0.1"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="max-positions">Max Open Positions</Label>
              <Input
                id="max-positions"
                type="number"
                value={trading.riskManagement.maxOpenPositions}
                onChange={(e) => handleRiskChange("maxOpenPositions", Number(e.target.value))}
                placeholder="5"
                min="1"
                max="50"
              />
            </div>
          </div>

          {/* Risk Summary */}
          <div className="p-4 bg-muted rounded-lg">
            <h4 className="font-medium mb-2">Risk Summary</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Max Position</div>
                <div className="font-medium">${trading.riskManagement.maxPositionSize.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Daily Loss Limit</div>
                <div className="font-medium">${trading.riskManagement.maxDailyLoss.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Max Positions</div>
                <div className="font-medium">{trading.riskManagement.maxOpenPositions}</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Chart Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <BarChart3 className="h-5 w-5" />
            <span>Chart Preferences</span>
          </CardTitle>
          <CardDescription>Customize your trading chart settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SettingsSelect
              id="chart-timeframe"
              label="Default Timeframe"
              description="Your preferred chart timeframe"
              value={trading.chartPreferences.defaultTimeframe}
              onValueChange={(value) => handleChartChange("defaultTimeframe", value)}
              options={CHART_TIMEFRAMES}
            />

            <SettingsSelect
              id="chart-type"
              label="Chart Type"
              description="Your preferred chart visualization"
              value={trading.chartPreferences.chartType}
              onValueChange={(value) => handleChartChange("chartType", value)}
              options={chartTypeOptions}
            />

            <SettingsSelect
              id="chart-theme"
              label="Chart Theme"
              description="Color scheme for your charts"
              value={trading.chartPreferences.theme}
              onValueChange={(value) => handleChartChange("theme", value)}
              options={chartThemeOptions}
            />
          </div>

          <div className="space-y-2">
            <Label>Default Technical Indicators</Label>
            <div className="flex flex-wrap gap-2">
              {TECHNICAL_INDICATORS.map((indicator) => (
                <Badge
                  key={indicator}
                  variant={trading.chartPreferences.indicators.includes(indicator) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => {
                    const indicators = trading.chartPreferences.indicators.includes(indicator)
                      ? trading.chartPreferences.indicators.filter((i) => i !== indicator)
                      : [...trading.chartPreferences.indicators, indicator]
                    handleChartChange("indicators", indicators)
                  }}
                >
                  {indicator}
                </Badge>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Click indicators to add/remove them from your default chart setup
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
