"use client"

import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import type { BotSettingsState } from "../../../types"
import { EXECUTION_MODES, ORDER_TYPES, EXECUTION_SCHEDULES } from "../../../constants"
import { SettingsFormField } from "../../shared/settings-form-field"

interface AdvancedTabProps {
  settings: BotSettingsState
  onUpdate: <K extends keyof BotSettingsState>(key: K, value: BotSettingsState[K]) => void
}

export function AdvancedTab({ settings, onUpdate }: AdvancedTabProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Notifications</h3>

        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Switch
              id="notifications-enabled"
              checked={settings.notificationsEnabled}
              onCheckedChange={(checked) => onUpdate("notificationsEnabled", checked)}
            />
            <SettingsFormField label="Enable Notifications">
              <></>
            </SettingsFormField>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex items-center space-x-2">
            <Switch
              id="email-notifications"
              checked={settings.emailNotifications}
              onCheckedChange={(checked) => onUpdate("emailNotifications", checked)}
              disabled={!settings.notificationsEnabled}
            />
            <SettingsFormField label="Email" className={!settings.notificationsEnabled ? "text-muted-foreground" : ""}>
              <></>
            </SettingsFormField>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="push-notifications"
              checked={settings.pushNotifications}
              onCheckedChange={(checked) => onUpdate("pushNotifications", checked)}
              disabled={!settings.notificationsEnabled}
            />
            <SettingsFormField label="Push" className={!settings.notificationsEnabled ? "text-muted-foreground" : ""}>
              <></>
            </SettingsFormField>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="telegram-notifications"
              checked={settings.telegramNotifications}
              onCheckedChange={(checked) => onUpdate("telegramNotifications", checked)}
              disabled={!settings.notificationsEnabled}
            />
            <SettingsFormField
              label="Telegram"
              className={!settings.notificationsEnabled ? "text-muted-foreground" : ""}
            >
              <></>
            </SettingsFormField>
          </div>
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <h3 className="text-lg font-medium">Execution Settings</h3>

        <div className="grid gap-4 md:grid-cols-2">
          <SettingsFormField label="Execution Mode">
            <Select value={settings.executionMode} onValueChange={(value) => onUpdate("executionMode", value)}>
              <SelectTrigger>
                <SelectValue placeholder="Select execution mode" />
              </SelectTrigger>
              <SelectContent>
                {EXECUTION_MODES.map((mode) => (
                  <SelectItem key={mode.value} value={mode.value}>
                    {mode.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsFormField>

          <SettingsFormField label="Default Order Type">
            <Select value={settings.orderType} onValueChange={(value) => onUpdate("orderType", value)}>
              <SelectTrigger>
                <SelectValue placeholder="Select order type" />
              </SelectTrigger>
              <SelectContent>
                {ORDER_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsFormField>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <SettingsFormField label="Slippage Tolerance (%)">
            <Input
              type="number"
              value={settings.slippageTolerance}
              onChange={(e) => onUpdate("slippageTolerance", Number(e.target.value))}
            />
          </SettingsFormField>

          <SettingsFormField label="Retry Attempts">
            <Input
              type="number"
              value={settings.retryAttempts}
              onChange={(e) => onUpdate("retryAttempts", Number(e.target.value))}
            />
          </SettingsFormField>
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <h3 className="text-lg font-medium">Advanced Options</h3>

        <SettingsFormField label="Execution Schedule">
          <Select value={settings.executionSchedule} onValueChange={(value) => onUpdate("executionSchedule", value)}>
            <SelectTrigger>
              <SelectValue placeholder="Select schedule" />
            </SelectTrigger>
            <SelectContent>
              {EXECUTION_SCHEDULES.map((schedule) => (
                <SelectItem key={schedule.value} value={schedule.value}>
                  {schedule.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsFormField>

        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Switch
              id="debug-mode"
              checked={settings.debugMode}
              onCheckedChange={(checked) => onUpdate("debugMode", checked)}
            />
            <SettingsFormField label="Debug Mode" tooltip="Enables detailed logging for troubleshooting">
              <></>
            </SettingsFormField>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Switch
              id="test-mode"
              checked={settings.testMode}
              onCheckedChange={(checked) => onUpdate("testMode", checked)}
            />
            <SettingsFormField label="Test Mode" tooltip="Simulates trades without executing real orders">
              <></>
            </SettingsFormField>
          </div>
        </div>
      </div>
    </div>
  )
}
