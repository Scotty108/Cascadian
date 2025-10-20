"use client"

import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import type { BotSettingsState } from "../../../types"
import { SettingsFormField } from "../../shared/settings-form-field"

interface MeanReversionParametersProps {
  settings: BotSettingsState
  onUpdate: <K extends keyof BotSettingsState>(key: K, value: BotSettingsState[K]) => void
}

export function MeanReversionParameters({ settings, onUpdate }: MeanReversionParametersProps) {
  return (
    <div className="space-y-4">
      <SettingsFormField label="Mean Lookback Period">
        <Input
          type="number"
          value={settings.meanLookback}
          onChange={(e) => onUpdate("meanLookback", Number(e.target.value))}
        />
      </SettingsFormField>

      <SettingsFormField label="Bollinger Bands Period">
        <Input
          type="number"
          value={settings.bollingerPeriod}
          onChange={(e) => onUpdate("bollingerPeriod", Number(e.target.value))}
        />
      </SettingsFormField>

      <SettingsFormField label={`Standard Deviation Multiplier (${settings.bollingerStd})`}>
        <Slider
          min={1}
          max={3}
          step={0.1}
          value={[settings.bollingerStd]}
          onValueChange={(value) => onUpdate("bollingerStd", value[0])}
          className="mt-2"
        />
      </SettingsFormField>

      <SettingsFormField label={`RSI Oversold Level (${settings.rsiOversold})`}>
        <Slider
          min={10}
          max={40}
          step={1}
          value={[settings.rsiOversold]}
          onValueChange={(value) => onUpdate("rsiOversold", value[0])}
          className="mt-2"
        />
      </SettingsFormField>

      <SettingsFormField label={`RSI Overbought Level (${settings.rsiOverbought})`}>
        <Slider
          min={60}
          max={90}
          step={1}
          value={[settings.rsiOverbought]}
          onValueChange={(value) => onUpdate("rsiOverbought", value[0])}
          className="mt-2"
        />
      </SettingsFormField>
    </div>
  )
}
