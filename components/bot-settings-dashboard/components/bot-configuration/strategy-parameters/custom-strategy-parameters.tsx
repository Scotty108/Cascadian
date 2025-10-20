"use client"

import type React from "react"

import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { FileText, Upload } from "lucide-react"
import type { BotSettingsState } from "../../../types"
import { SettingsFormField } from "../../shared/settings-form-field"

interface CustomStrategyParametersProps {
  settings: BotSettingsState
  onUpdate: <K extends keyof BotSettingsState>(key: K, value: BotSettingsState[K]) => void
}

export function CustomStrategyParameters({ settings, onUpdate }: CustomStrategyParametersProps) {
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        onUpdate("customStrategyJson", content)
      }
      reader.readAsText(file)
    }
  }

  const validateJson = () => {
    try {
      JSON.parse(settings.customStrategyJson)
      return true
    } catch {
      return false
    }
  }

  return (
    <div className="space-y-4">
      <SettingsFormField label="Custom Strategy Configuration">
        <Textarea
          value={settings.customStrategyJson}
          onChange={(e) => onUpdate("customStrategyJson", e.target.value)}
          placeholder="Enter your custom strategy JSON configuration..."
          className="min-h-[200px] font-mono text-sm"
        />
      </SettingsFormField>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <label htmlFor="strategy-file">
            <Upload className="mr-2 h-4 w-4" />
            Upload File
            <input id="strategy-file" type="file" accept=".json,.txt" onChange={handleFileUpload} className="hidden" />
          </label>
        </Button>

        <Button variant="outline" size="sm">
          <FileText className="mr-2 h-4 w-4" />
          Load Template
        </Button>

        {settings.customStrategyJson && (
          <div className={`text-sm ${validateJson() ? "text-green-600" : "text-red-600"}`}>
            {validateJson() ? "✓ Valid JSON" : "✗ Invalid JSON"}
          </div>
        )}
      </div>

      <div className="p-4 bg-muted rounded-lg">
        <h4 className="font-medium mb-2">Strategy Template Example:</h4>
        <pre className="text-xs text-muted-foreground overflow-x-auto">
          {`{
  "name": "Custom Momentum Strategy",
  "indicators": {
    "rsi": { "period": 14, "overbought": 70, "oversold": 30 },
    "macd": { "fast": 12, "slow": 26, "signal": 9 }
  },
  "entry_conditions": ["rsi < 30", "macd_histogram > 0"],
  "exit_conditions": ["rsi > 70", "profit > 5%"],
  "risk_management": {
    "stop_loss": 3,
    "take_profit": 8,
    "position_size": 0.1
  }
}`}
        </pre>
      </div>
    </div>
  )
}
