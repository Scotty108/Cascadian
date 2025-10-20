"use client"

import type React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SettingsSelect } from "../shared/settings-select"
import { SettingsToggle } from "../shared/settings-toggle"
import { Monitor, Moon, Sun, Palette, Globe, Clock } from "lucide-react"
import type { AppearanceSettings } from "../../types"
import { LANGUAGES, TIMEZONES } from "../../constants"

interface AppearanceTabProps {
  appearance: AppearanceSettings
  onAppearanceChange: (updates: Partial<AppearanceSettings>) => void
}

export const AppearanceTab: React.FC<AppearanceTabProps> = ({ appearance, onAppearanceChange }) => {
  const handleThemeChange = (theme: string) => {
    onAppearanceChange({ theme: theme as "light" | "dark" | "system" })
  }

  const handleDensityChange = (density: string) => {
    onAppearanceChange({ density: density as "compact" | "comfortable" | "spacious" })
  }

  const handleLanguageChange = (language: string) => {
    onAppearanceChange({ language })
  }

  const handleTimezoneChange = (timezone: string) => {
    onAppearanceChange({ timezone })
  }

  const handleDateFormatChange = (dateFormat: string) => {
    onAppearanceChange({ dateFormat })
  }

  const handleTimeFormatChange = (timeFormat: string) => {
    onAppearanceChange({ timeFormat: timeFormat as "12h" | "24h" })
  }

  const handleAccessibilityChange = (key: keyof AppearanceSettings["accessibility"], value: boolean) => {
    onAppearanceChange({
      accessibility: { ...appearance.accessibility, [key]: value },
    })
  }

  const themeOptions = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "System" },
  ]

  const densityOptions = [
    { value: "compact", label: "Compact" },
    { value: "comfortable", label: "Comfortable" },
    { value: "spacious", label: "Spacious" },
  ]

  const dateFormatOptions = [
    { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
    { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
    { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
  ]

  const timeFormatOptions = [
    { value: "12h", label: "12 Hour (AM/PM)" },
    { value: "24h", label: "24 Hour" },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Appearance Settings</h2>
        <p className="text-muted-foreground">Customize the look and feel of your interface</p>
      </div>

      {/* Theme Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Palette className="h-5 w-5" />
            <span>Theme & Display</span>
          </CardTitle>
          <CardDescription>Choose your preferred theme and display density</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsSelect
            id="theme"
            label="Theme"
            description="Choose between light, dark, or system theme"
            value={appearance.theme}
            onValueChange={handleThemeChange}
            options={themeOptions}
          />

          <SettingsSelect
            id="density"
            label="Display Density"
            description="Adjust the spacing and size of interface elements"
            value={appearance.density}
            onValueChange={handleDensityChange}
            options={densityOptions}
          />

          {/* Theme Preview */}
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div className="text-center">
              <div className="w-full h-20 bg-white border-2 border-gray-200 rounded-lg mb-2 flex items-center justify-center">
                <Sun className="h-6 w-6 text-yellow-500" />
              </div>
              <span className="text-sm">Light</span>
            </div>
            <div className="text-center">
              <div className="w-full h-20 bg-gray-900 border-2 border-gray-700 rounded-lg mb-2 flex items-center justify-center">
                <Moon className="h-6 w-6 text-blue-400" />
              </div>
              <span className="text-sm">Dark</span>
            </div>
            <div className="text-center">
              <div className="w-full h-20 bg-gradient-to-br from-white to-gray-900 border-2 border-gray-400 rounded-lg mb-2 flex items-center justify-center">
                <Monitor className="h-6 w-6 text-gray-600" />
              </div>
              <span className="text-sm">System</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Language & Region */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Globe className="h-5 w-5" />
            <span>Language & Region</span>
          </CardTitle>
          <CardDescription>Set your language and regional preferences</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsSelect
            id="language"
            label="Language"
            description="Choose your preferred language"
            value={appearance.language}
            onValueChange={handleLanguageChange}
            options={LANGUAGES}
          />

          <SettingsSelect
            id="timezone"
            label="Timezone"
            description="Set your local timezone for accurate time display"
            value={appearance.timezone}
            onValueChange={handleTimezoneChange}
            options={TIMEZONES}
          />
        </CardContent>
      </Card>

      {/* Date & Time Format */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Clock className="h-5 w-5" />
            <span>Date & Time Format</span>
          </CardTitle>
          <CardDescription>Customize how dates and times are displayed</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsSelect
            id="dateFormat"
            label="Date Format"
            description="Choose your preferred date format"
            value={appearance.dateFormat}
            onValueChange={handleDateFormatChange}
            options={dateFormatOptions}
          />

          <SettingsSelect
            id="timeFormat"
            label="Time Format"
            description="Choose between 12-hour and 24-hour time format"
            value={appearance.timeFormat}
            onValueChange={handleTimeFormatChange}
            options={timeFormatOptions}
          />

          {/* Format Preview */}
          <div className="p-4 bg-muted rounded-lg">
            <h4 className="font-medium mb-2">Preview</h4>
            <div className="space-y-1 text-sm">
              <div>
                Date:{" "}
                {new Date().toLocaleDateString("en-US", {
                  year: "numeric",
                  month: appearance.dateFormat.includes("MM") ? "2-digit" : "numeric",
                  day: "2-digit",
                })}
              </div>
              <div>
                Time:{" "}
                {new Date().toLocaleTimeString("en-US", {
                  hour12: appearance.timeFormat === "12h",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Accessibility */}
      <Card>
        <CardHeader>
          <CardTitle>Accessibility</CardTitle>
          <CardDescription>Options to improve accessibility and usability</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="high-contrast"
            label="High Contrast Mode"
            description="Increase contrast for better visibility"
            checked={appearance.accessibility.highContrast}
            onCheckedChange={(checked) => handleAccessibilityChange("highContrast", checked)}
          />

          <SettingsToggle
            id="reduced-motion"
            label="Reduce Motion"
            description="Minimize animations and transitions"
            checked={appearance.accessibility.reducedMotion}
            onCheckedChange={(checked) => handleAccessibilityChange("reducedMotion", checked)}
          />

          <SettingsToggle
            id="large-text"
            label="Large Text"
            description="Increase text size for better readability"
            checked={appearance.accessibility.largeText}
            onCheckedChange={(checked) => handleAccessibilityChange("largeText", checked)}
          />

          <SettingsToggle
            id="screen-reader"
            label="Screen Reader Support"
            description="Enhanced support for screen readers"
            checked={appearance.accessibility.screenReader}
            onCheckedChange={(checked) => handleAccessibilityChange("screenReader", checked)}
          />
        </CardContent>
      </Card>
    </div>
  )
}
