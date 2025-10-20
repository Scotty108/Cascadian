"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Eye, EyeOff } from "lucide-react";
import { BOT_TYPES, EXCHANGES } from "../../../constants";
import type { BotSettingsState } from "../../../types";
import { SettingsFormField } from "../../shared/settings-form-field";

interface GeneralTabProps {
  settings: BotSettingsState;
  onUpdate: <K extends keyof BotSettingsState>(key: K, value: BotSettingsState[K]) => void;
}

export function GeneralTab({ settings, onUpdate }: GeneralTabProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <SettingsFormField label="Bot Name">
          <Input value={settings.botName} onChange={(e) => onUpdate("botName", e.target.value)} />
        </SettingsFormField>

        <SettingsFormField label="Bot Type">
          <Select value={settings.botType} onValueChange={(value) => onUpdate("botType", value)}>
            <SelectTrigger>
              <SelectValue placeholder="Select bot type" />
            </SelectTrigger>
            <SelectContent>
              {BOT_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsFormField>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <SettingsFormField label="Exchange">
          <Select value={settings.exchange} onValueChange={(value) => onUpdate("exchange", value)}>
            <SelectTrigger>
              <SelectValue placeholder="Select exchange" />
            </SelectTrigger>
            <SelectContent>
              {EXCHANGES.map((exchange) => (
                <SelectItem key={exchange.value} value={exchange.value}>
                  {exchange.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsFormField>

        <SettingsFormField label="Trading Pair">
          <Input value={settings.tradingPair} onChange={(e) => onUpdate("tradingPair", e.target.value)} />
        </SettingsFormField>
      </div>

      <SettingsFormField label="API Key">
        <div className="relative">
          <Input type={settings.showApiKey ? "text" : "password"} value={settings.apiKey} onChange={(e) => onUpdate("apiKey", e.target.value)} />
          <Button variant="ghost" size="sm" className="absolute right-0 top-0 h-full px-3" onClick={() => onUpdate("showApiKey", !settings.showApiKey)}>
            {settings.showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </SettingsFormField>

      <SettingsFormField label="API Secret">
        <div className="relative">
          <Input type="password" value={settings.apiSecret} onChange={(e) => onUpdate("apiSecret", e.target.value)} />
          <Button variant="ghost" size="sm" className="absolute right-0 top-0 h-full px-3">
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      </SettingsFormField>

      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Switch id="auto-start" checked={settings.autoStart} onCheckedChange={(checked) => onUpdate("autoStart", checked)} />
          <SettingsFormField label="Auto-start on platform launch" tooltip="Bot will automatically start when the platform launches">
            <></>
          </SettingsFormField>
        </div>
      </div>
    </div>
  );
}
