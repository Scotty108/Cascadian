"use client"

import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import type { BotSettingsState } from "../../../types"
import { SettingsFormField } from "../../shared/settings-form-field"

interface MomentumParametersProps {
  settings: BotSettingsState
  onUpdate: <K extends keyof BotSettingsState>(key: K, value: BotSettingsState[K]) => void
}

export function MomentumParameters({ settings, onUpdate }: MomentumParametersProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <h4 className="font-medium">RSI Settings</h4>
        <div className="grid gap-4 md:grid-cols-3">
          <SettingsFormField label="RSI Period">
            <Input
              type="number"
              value={settings.rsiPeriod}
              onChange={(e) => onUpdate("rsiPeriod", Number(e.target.value))}
            />
          </SettingsFormField>

          <SettingsFormField label={`Overbought (${settings.rsiOverbought})`}>
            <Slider
              min={60}
              max={90}
              step={1}
              value={[settings.rsiOverbought]}
              onValueChange={(value) => onUpdate("rsiOverbought", value[0])}
              className="mt-2"
            />
          </SettingsFormField>

          <SettingsFormField label={`Oversold (${settings.rsiOversold})`}>
            <Slider
              min={10}
              max={40}
              step={1}
              value={[settings.rsiOversold]}
              onValueChange={(value) => onUpdate("rsiOversold", value[0])}
              className="mt-2"
            />
          </SettingsFormField>
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <h4 className="font-medium">MACD Settings</h4>
        <div className="grid gap-4 md:grid-cols-3">
          <SettingsFormField label="Fast Period">
            <Input
              type="number"
              value={settings.macdFast}
              onChange={(e) => onUpdate("macdFast", Number(e.target.value))}
            />
          </SettingsFormField>

          <SettingsFormField label="Slow Period">
            <Input
              type="number"
              value={settings.macdSlow}
              onChange={(e) => onUpdate("macdSlow", Number(e.target.value))}
            />
          </SettingsFormField>

          <SettingsFormField label="Signal Period">
            <Input
              type="number"
              value={settings.macdSignal}
              onChange={(e) => onUpdate("macdSignal", Number(e.target.value))}
            />
          </SettingsFormField>
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <h4 className="font-medium">Bollinger Bands</h4>
        <div className="grid gap-4 md:grid-cols-2">
          <SettingsFormField label="Period">
            <Input
              type="number"
              value={settings.bollingerPeriod}
              onChange={(e) => onUpdate("bollingerPeriod", Number(e.target.value))}
            />
          </SettingsFormField>

          <SettingsFormField label="Standard Deviation">
            <Input
              type="number"
              step="0.1"
              value={settings.bollingerStd}
              onChange={(e) => onUpdate("bollingerStd", Number(e.target.value))}
            />
          </SettingsFormField>
        </div>
      </div>
    </div>
  )
}
