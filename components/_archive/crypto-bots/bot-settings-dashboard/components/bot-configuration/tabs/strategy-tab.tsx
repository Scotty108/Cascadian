"use client"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import type { BotSettingsState } from "../../../types"
import { STRATEGIES, TIMEFRAMES } from "../../../constants"
import { SettingsFormField } from "../../shared/settings-form-field"
import { MomentumParameters } from "../strategy-parameters/momentum-parameters"
import { MeanReversionParameters } from "../strategy-parameters/mean-reversion-parameters"
import { DcaParameters } from "../strategy-parameters/dca-parameters"
import { CustomStrategyParameters } from "../strategy-parameters/custom-strategy-parameters"

interface StrategyTabProps {
  settings: BotSettingsState
  onUpdate: <K extends keyof BotSettingsState>(key: K, value: BotSettingsState[K]) => void
}

export function StrategyTab({ settings, onUpdate }: StrategyTabProps) {
  const renderStrategyParameters = () => {
    switch (settings.strategy) {
      case "momentum":
        return <MomentumParameters settings={settings} onUpdate={onUpdate} />
      case "mean-reversion":
        return <MeanReversionParameters settings={settings} onUpdate={onUpdate} />
      case "dca":
        return <DcaParameters settings={settings} onUpdate={onUpdate} />
      case "custom":
        return <CustomStrategyParameters settings={settings} onUpdate={onUpdate} />
      default:
        return <div className="text-center py-8 text-muted-foreground">Select a strategy to configure parameters</div>
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <SettingsFormField label="Trading Strategy">
          <Select value={settings.strategy} onValueChange={(value) => onUpdate("strategy", value)}>
            <SelectTrigger>
              <SelectValue placeholder="Select strategy" />
            </SelectTrigger>
            <SelectContent>
              {STRATEGIES.map((strategy) => (
                <SelectItem key={strategy.value} value={strategy.value}>
                  {strategy.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsFormField>

        <SettingsFormField label="Timeframe">
          <Select value={settings.timeframe} onValueChange={(value) => onUpdate("timeframe", value)}>
            <SelectTrigger>
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
        </SettingsFormField>
      </div>

      <SettingsFormField
        label={`Maximum Position Size (${settings.maxPositionSize}%)`}
        tooltip="Maximum percentage of your portfolio to allocate to a single position"
      >
        <Slider
          min={1}
          max={100}
          step={1}
          value={[settings.maxPositionSize]}
          onValueChange={(value) => onUpdate("maxPositionSize", value[0])}
          className="mt-2"
        />
      </SettingsFormField>

      <Separator />

      <div className="space-y-4">
        <h3 className="text-lg font-medium">Strategy Parameters</h3>
        {renderStrategyParameters()}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Switch
            id="ai-assistance"
            checked={settings.aiAssistance}
            onCheckedChange={(checked) => onUpdate("aiAssistance", checked)}
          />
          <SettingsFormField
            label="AI-assisted strategy optimization"
            tooltip="Uses AI to optimize strategy parameters based on market conditions"
          >
            <></>
          </SettingsFormField>
        </div>
      </div>
    </div>
  )
}
