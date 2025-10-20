"use client"

import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import type { BotSettingsState } from "../../../types"
import { RISK_LEVELS, CURRENCIES } from "../../../constants"
import { SettingsFormField } from "../../shared/settings-form-field"

interface RiskManagementTabProps {
  settings: BotSettingsState
  onUpdate: <K extends keyof BotSettingsState>(key: K, value: BotSettingsState[K]) => void
}

export function RiskManagementTab({ settings, onUpdate }: RiskManagementTabProps) {
  return (
    <div className="space-y-4">
      <SettingsFormField label="Risk Level">
        <Select value={settings.riskLevel} onValueChange={(value) => onUpdate("riskLevel", value)}>
          <SelectTrigger>
            <SelectValue placeholder="Select risk level" />
          </SelectTrigger>
          <SelectContent>
            {RISK_LEVELS.map((level) => (
              <SelectItem key={level.value} value={level.value}>
                <div className="flex flex-col">
                  <span>{level.label}</span>
                  <span className="text-xs text-muted-foreground">{level.description}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsFormField>

      <div className="grid gap-4 md:grid-cols-2">
        <SettingsFormField
          label={`Stop Loss (${settings.stopLossPercentage}%)`}
          tooltip="Percentage loss at which to automatically close positions"
        >
          <Slider
            min={1}
            max={20}
            step={0.5}
            value={[settings.stopLossPercentage]}
            onValueChange={(value) => onUpdate("stopLossPercentage", value[0])}
            className="mt-2"
          />
        </SettingsFormField>

        <SettingsFormField
          label={`Take Profit (${settings.takeProfitPercentage}%)`}
          tooltip="Percentage gain at which to automatically close positions"
        >
          <Slider
            min={1}
            max={50}
            step={0.5}
            value={[settings.takeProfitPercentage]}
            onValueChange={(value) => onUpdate("takeProfitPercentage", value[0])}
            className="mt-2"
          />
        </SettingsFormField>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Switch
            id="trailing-stop-loss"
            checked={settings.trailingStopLoss}
            onCheckedChange={(checked) => onUpdate("trailingStopLoss", checked)}
          />
          <SettingsFormField label="Trailing Stop Loss" tooltip="Adjusts stop loss as price moves in your favor">
            <></>
          </SettingsFormField>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Switch
            id="trailing-take-profit"
            checked={settings.trailingTakeProfit}
            onCheckedChange={(checked) => onUpdate("trailingTakeProfit", checked)}
          />
          <SettingsFormField label="Trailing Take Profit" tooltip="Adjusts take profit as price moves in your favor">
            <></>
          </SettingsFormField>
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <h3 className="text-lg font-medium">Position Sizing</h3>

        <div className="grid gap-4 md:grid-cols-2">
          <SettingsFormField label="Minimum Position Size">
            <div className="flex">
              <Input
                type="number"
                value={settings.minPositionSize}
                onChange={(e) => onUpdate("minPositionSize", Number(e.target.value))}
              />
              <Select
                value={settings.minPositionCurrency}
                onValueChange={(value) => onUpdate("minPositionCurrency", value)}
              >
                <SelectTrigger className="w-[100px] ml-2">
                  <SelectValue placeholder="Currency" />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((currency) => (
                    <SelectItem key={currency.value} value={currency.value}>
                      {currency.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </SettingsFormField>

          <SettingsFormField label="Maximum Open Positions">
            <Input
              type="number"
              value={settings.maxOpenPositions}
              onChange={(e) => onUpdate("maxOpenPositions", Number(e.target.value))}
            />
          </SettingsFormField>
        </div>

        <SettingsFormField
          label="Maximum Drawdown (%)"
          tooltip="Bot will pause trading if drawdown exceeds this percentage"
        >
          <Input
            type="number"
            value={settings.maxDrawdown}
            onChange={(e) => onUpdate("maxDrawdown", Number(e.target.value))}
          />
        </SettingsFormField>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Switch
            id="auto-rebalance"
            checked={settings.autoRebalance}
            onCheckedChange={(checked) => onUpdate("autoRebalance", checked)}
          />
          <SettingsFormField
            label="Auto-rebalance portfolio"
            tooltip="Automatically rebalance portfolio to maintain target allocations"
          >
            <></>
          </SettingsFormField>
        </div>
      </div>
    </div>
  )
}
