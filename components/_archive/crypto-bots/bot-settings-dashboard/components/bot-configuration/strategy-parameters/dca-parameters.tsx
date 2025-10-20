"use client"

import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { BotSettingsState } from "../../../types"
import { DCA_INTERVALS } from "../../../constants"
import { SettingsFormField } from "../../shared/settings-form-field"

interface DcaParametersProps {
  settings: BotSettingsState
  onUpdate: <K extends keyof BotSettingsState>(key: K, value: BotSettingsState[K]) => void
}

export function DcaParameters({ settings, onUpdate }: DcaParametersProps) {
  return (
    <div className="space-y-4">
      <SettingsFormField label="DCA Interval">
        <Select value={settings.dcaInterval} onValueChange={(value) => onUpdate("dcaInterval", value)}>
          <SelectTrigger>
            <SelectValue placeholder="Select interval" />
          </SelectTrigger>
          <SelectContent>
            {DCA_INTERVALS.map((interval) => (
              <SelectItem key={interval.value} value={interval.value}>
                {interval.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsFormField>

      <SettingsFormField label="DCA Amount (USD)">
        <Input
          type="number"
          value={settings.dcaAmount}
          onChange={(e) => onUpdate("dcaAmount", Number(e.target.value))}
        />
      </SettingsFormField>

      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Switch
            id="dca-dynamic"
            checked={settings.dcaDynamic}
            onCheckedChange={(checked) => onUpdate("dcaDynamic", checked)}
          />
          <SettingsFormField label="Dynamic DCA Amount" tooltip="Adjusts DCA amount based on market volatility">
            <></>
          </SettingsFormField>
        </div>
      </div>

      <SettingsFormField label="Price Deviation Threshold (%)">
        <Input type="number" step="0.1" placeholder="5.0" className="mt-2" />
      </SettingsFormField>

      <SettingsFormField label="Maximum DCA Orders">
        <Input type="number" placeholder="10" className="mt-2" />
      </SettingsFormField>
    </div>
  )
}
