"use client"

import { Shield, Gauge } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { CustomizationSettings } from "../types"
import { TRADING_PAIRS, TIMEFRAMES, TRADING_HOURS_OPTIONS } from "../constants"

interface CustomizationPanelProps {
  settings: CustomizationSettings
  onUpdateSetting: (key: keyof CustomizationSettings, value: any) => void
  onBack: () => void
  onDeploy: () => void
}

export function CustomizationPanel({ settings, onUpdateSetting, onBack, onDeploy }: CustomizationPanelProps) {
  return (
    <>
      <h3 className="text-lg font-semibold">Customize Bot</h3>
      <div className="mt-4 space-y-4">
        <div>
          <Label htmlFor="risk-level">Risk Level</Label>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-blue-500" />
            <Slider
              id="risk-level"
              value={[settings.riskLevel]}
              min={0}
              max={100}
              step={1}
              onValueChange={(value) => onUpdateSetting("riskLevel", value[0])}
              className="flex-1"
            />
            <Gauge className="h-4 w-4 text-red-500" />
          </div>
          <div className="mt-1 flex justify-between text-xs text-muted-foreground">
            <span>Conservative</span>
            <span>Aggressive</span>
          </div>
        </div>

        <div>
          <Label htmlFor="trading-pairs">Trading Pairs</Label>
          <Select value={settings.tradingPairs[0]} onValueChange={(value) => onUpdateSetting("tradingPairs", [value])}>
            <SelectTrigger id="trading-pairs">
              <SelectValue placeholder="Select trading pair" />
            </SelectTrigger>
            <SelectContent>
              {TRADING_PAIRS.map((pair) => (
                <SelectItem key={pair} value={pair}>
                  {pair}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="timeframe">Timeframe</Label>
          <Select value={settings.timeframe} onValueChange={(value) => onUpdateSetting("timeframe", value)}>
            <SelectTrigger id="timeframe">
              <SelectValue placeholder="Select timeframe" />
            </SelectTrigger>
            <SelectContent>
              {TIMEFRAMES.map((timeframe) => (
                <SelectItem key={timeframe.value} value={timeframe.value}>
                  {timeframe.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="max-positions">Max Positions</Label>
          <Select
            value={settings.maxPositions.toString()}
            onValueChange={(value) => onUpdateSetting("maxPositions", Number.parseInt(value))}
          >
            <SelectTrigger id="max-positions">
              <SelectValue placeholder="Select max positions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1</SelectItem>
              <SelectItem value="2">2</SelectItem>
              <SelectItem value="3">3</SelectItem>
              <SelectItem value="5">5</SelectItem>
              <SelectItem value="10">10</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="stop-loss">Stop Loss (%)</Label>
            <Input
              id="stop-loss"
              type="number"
              value={settings.stopLoss}
              onChange={(e) => onUpdateSetting("stopLoss", Number.parseFloat(e.target.value))}
              min={1}
              max={50}
            />
          </div>
          <div>
            <Label htmlFor="take-profit">Take Profit (%)</Label>
            <Input
              id="take-profit"
              type="number"
              value={settings.takeProfit}
              onChange={(e) => onUpdateSetting("takeProfit", Number.parseFloat(e.target.value))}
              min={1}
              max={100}
            />
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Switch
            id="reinvest-profits"
            checked={settings.reinvestProfits}
            onCheckedChange={(checked) => onUpdateSetting("reinvestProfits", checked)}
          />
          <Label htmlFor="reinvest-profits">Reinvest Profits</Label>
        </div>

        <div className="flex items-center space-x-2">
          <Switch
            id="enable-notifications"
            checked={settings.enableNotifications}
            onCheckedChange={(checked) => onUpdateSetting("enableNotifications", checked)}
          />
          <Label htmlFor="enable-notifications">Enable Notifications</Label>
        </div>

        <div>
          <Label htmlFor="trading-hours">Trading Hours</Label>
          <Select value={settings.tradingHours} onValueChange={(value) => onUpdateSetting("tradingHours", value)}>
            <SelectTrigger id="trading-hours">
              <SelectValue placeholder="Select trading hours" />
            </SelectTrigger>
            <SelectContent>
              {TRADING_HOURS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-6 flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onBack}>
          Back
        </Button>
        <Button className="flex-1" onClick={onDeploy}>
          Deploy Bot
        </Button>
      </div>
    </>
  )
}
