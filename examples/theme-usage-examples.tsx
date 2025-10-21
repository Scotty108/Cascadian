/**
 * Theme System Usage Examples
 *
 * This file contains practical examples of using the Cascadian theme system
 * in various scenarios. Copy and adapt these patterns for your own components.
 */

import { useThemePreset } from '@/components/theme-preset-provider'
import { ThemePresetSwitcher, ThemePresetGallery } from '@/components/theme-preset-switcher'
import { ThemeEditor } from '@/components/theme-editor'
import {
  themePresets,
  applyThemePreset,
  getThemeById,
  getThemesByTag,
  forestTheme,
  midnightTheme,
  type ThemePreset,
} from '@/lib/theme-presets'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { useTheme } from 'next-themes'

// ============================================================================
// EXAMPLE 1: Basic Theme Preset Selector
// ============================================================================

export function BasicPresetSelector() {
  const { currentPreset, setPreset, availablePresets } = useThemePreset()

  return (
    <div className="space-y-2">
      <h3 className="font-semibold">Select Theme</h3>
      <div className="flex gap-2 flex-wrap">
        {availablePresets.map(preset => (
          <Button
            key={preset.id}
            variant={currentPreset.id === preset.id ? 'default' : 'outline'}
            onClick={() => setPreset(preset)}
          >
            {preset.name}
          </Button>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// EXAMPLE 2: Dropdown Theme Selector
// ============================================================================

export function DropdownThemeSelector() {
  const { currentPreset, setPreset, availablePresets } = useThemePreset()

  return (
    <select
      value={currentPreset.id}
      onChange={(e) => {
        const preset = availablePresets.find(p => p.id === e.target.value)
        if (preset) setPreset(preset)
      }}
      className="px-3 py-2 rounded border"
    >
      {availablePresets.map(preset => (
        <option key={preset.id} value={preset.id}>
          {preset.name} - {preset.mood}
        </option>
      ))}
    </select>
  )
}

// ============================================================================
// EXAMPLE 3: Theme Card Gallery with Previews
// ============================================================================

export function ThemeCardGallery() {
  const { currentPreset, setPreset } = useThemePreset()

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {themePresets.map(preset => {
        const isActive = currentPreset.id === preset.id

        return (
          <Card
            key={preset.id}
            className={`p-4 cursor-pointer transition-all hover:shadow-lg ${
              isActive ? 'ring-2 ring-primary' : ''
            }`}
            onClick={() => setPreset(preset)}
          >
            {/* Color preview */}
            <div className="flex gap-2 mb-3">
              <div
                className="h-12 w-12 rounded"
                style={{
                  backgroundColor: `hsl(${preset.colors.primary.hue} ${preset.colors.primary.saturation}% ${preset.colors.primary.lightness}%)`,
                }}
              />
              <div
                className="h-12 w-12 rounded"
                style={{
                  backgroundColor: `hsl(${preset.colors.accent.hue} ${preset.colors.accent.saturation}% ${preset.colors.accent.lightness}%)`,
                }}
              />
            </div>

            {/* Theme info */}
            <h3 className="font-semibold">{preset.name}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {preset.description}
            </p>

            {/* Tags */}
            <div className="flex gap-1 mt-2 flex-wrap">
              {preset.tags?.map(tag => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

// ============================================================================
// EXAMPLE 4: Quick Action Buttons
// ============================================================================

export function QuickThemeButtons() {
  const { theme } = useTheme() // 'light' or 'dark'

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        onClick={() => applyThemePreset(forestTheme, theme === 'dark')}
      >
        🌲 Forest Mode
      </Button>
      <Button
        variant="outline"
        onClick={() => applyThemePreset(midnightTheme, theme === 'dark')}
      >
        🌃 Night Mode
      </Button>
    </div>
  )
}

// ============================================================================
// EXAMPLE 5: Filter Presets by Tag
// ============================================================================

export function FilteredThemeSelector() {
  const { setPreset } = useThemePreset()
  const darkThemes = getThemesByTag('dark')
  const calmThemes = getThemesByTag('calm')

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold mb-2">Dark Themes</h3>
        <div className="flex gap-2">
          {darkThemes.map(theme => (
            <Button
              key={theme.id}
              variant="outline"
              onClick={() => setPreset(theme)}
            >
              {theme.name}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-2">Calm Themes</h3>
        <div className="flex gap-2">
          {calmThemes.map(theme => (
            <Button
              key={theme.id}
              variant="outline"
              onClick={() => setPreset(theme)}
            >
              {theme.name}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// EXAMPLE 6: Theme Info Display
// ============================================================================

export function CurrentThemeInfo() {
  const { currentPreset, isCustom } = useThemePreset()

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">{currentPreset.name}</h3>
        {isCustom && <Badge>Customized</Badge>}
      </div>

      <p className="text-sm text-muted-foreground mb-3">
        {currentPreset.description}
      </p>

      <div className="space-y-2 text-sm">
        <div>
          <span className="font-medium">Mood:</span> {currentPreset.mood}
        </div>
        <div>
          <span className="font-medium">Best for:</span>{' '}
          {currentPreset.useCases.join(', ')}
        </div>
        <div className="flex gap-1 flex-wrap">
          {currentPreset.tags?.map(tag => (
            <Badge key={tag} variant="outline" className="text-xs">
              #{tag}
            </Badge>
          ))}
        </div>
      </div>
    </Card>
  )
}

// ============================================================================
// EXAMPLE 7: Time-Based Theme Switcher
// ============================================================================

export function TimeBasedThemeSwitcher() {
  const { setPreset } = useThemePreset()

  const applyTimeBasedTheme = () => {
    const hour = new Date().getHours()

    if (hour >= 6 && hour < 12) {
      // Morning: Professional default
      const morning = getThemeById('default')
      if (morning) setPreset(morning)
    } else if (hour >= 12 && hour < 18) {
      // Afternoon: Keep alert with oceanic
      const afternoon = getThemeById('oceanic')
      if (afternoon) setPreset(afternoon)
    } else if (hour >= 18 && hour < 22) {
      // Evening: Reduce blue light
      const evening = getThemeById('golden-hour')
      if (evening) setPreset(evening)
    } else {
      // Night: High contrast
      const night = getThemeById('midnight')
      if (night) setPreset(night)
    }
  }

  return (
    <Button onClick={applyTimeBasedTheme}>
      Auto-Select Theme for Current Time
    </Button>
  )
}

// ============================================================================
// EXAMPLE 8: Custom Component Using Theme Variables
// ============================================================================

export function ThemedCustomCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        // Use CSS variables directly
        backgroundColor: 'hsl(var(--primary) / 0.1)',
        borderColor: 'hsl(var(--primary))',
        borderWidth: '2px',
        borderRadius: 'var(--radius)',
        padding: 'calc(1rem * var(--spacing-scale))',
        fontSize: 'var(--base-font-size)',
        lineHeight: 'var(--body-line-height)',
      }}
      className="transition-all duration-300"
    >
      {children}
    </div>
  )
}

// ============================================================================
// EXAMPLE 9: Theme Settings Page
// ============================================================================

export function ThemeSettingsPage() {
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Theme Customization</h1>
        <p className="text-muted-foreground mt-2">
          Personalize your Cascadian trading experience
        </p>
      </div>

      {/* Current theme info */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Current Theme</h2>
        <CurrentThemeInfo />
      </section>

      {/* Preset gallery */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Choose a Preset</h2>
        <ThemePresetGallery />
      </section>

      {/* Advanced customization */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Advanced Customization</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Fine-tune colors, spacing, and typography to your exact preferences.
        </p>
        <div className="flex justify-center">
          <ThemeEditor />
        </div>
      </section>

      {/* Quick actions */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
        <TimeBasedThemeSwitcher />
      </section>
    </div>
  )
}

// ============================================================================
// EXAMPLE 10: Theme Recommendation Based on Trading Style
// ============================================================================

export function TradingStyleThemeRecommender() {
  const { setPreset } = useThemePreset()

  const recommendations = [
    {
      style: 'Day Trader',
      description: 'Active, fast-paced trading',
      themeId: 'default',
      reason: 'Professional, high-contrast for quick decisions',
    },
    {
      style: 'Swing Trader',
      description: 'Medium-term positions',
      themeId: 'oceanic',
      reason: 'Calm colors promote patient decision-making',
    },
    {
      style: 'HODLer',
      description: 'Long-term investor',
      themeId: 'forest',
      reason: 'Relaxed, natural theme for occasional check-ins',
    },
    {
      style: 'Night Owl',
      description: 'Late-night trading',
      themeId: 'midnight',
      reason: 'High-contrast neon reduces eye strain',
    },
  ]

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">
        Choose Theme Based on Your Trading Style
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {recommendations.map(rec => {
          const preset = getThemeById(rec.themeId)
          if (!preset) return null

          return (
            <Card key={rec.style} className="p-4">
              <h4 className="font-semibold">{rec.style}</h4>
              <p className="text-sm text-muted-foreground mt-1">
                {rec.description}
              </p>
              <div className="mt-3 flex items-center justify-between">
                <div>
                  <Badge variant="outline">{preset.name}</Badge>
                  <p className="text-xs text-muted-foreground mt-1">
                    {rec.reason}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => setPreset(preset)}
                >
                  Apply
                </Button>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================================
// EXAMPLE 11: Programmatic Theme Application
// ============================================================================

export function ProgrammaticThemeExample() {
  const { theme } = useTheme()

  // Apply theme based on market conditions
  const applyBullTheme = () => {
    const forest = getThemeById('forest') // Green for bull market
    if (forest) {
      applyThemePreset(forest, theme === 'dark')
    }
  }

  const applyBearTheme = () => {
    const midnight = getThemeById('midnight') // Red/dark for bear market
    if (midnight) {
      applyThemePreset(midnight, theme === 'dark')
    }
  }

  return (
    <div className="flex gap-2">
      <Button variant="outline" onClick={applyBullTheme}>
        📈 Bull Market Theme
      </Button>
      <Button variant="outline" onClick={applyBearTheme}>
        📉 Bear Market Theme
      </Button>
    </div>
  )
}

// ============================================================================
// EXAMPLE 12: Complete Theme Dashboard Widget
// ============================================================================

export function ThemeDashboardWidget() {
  const { currentPreset, isCustom } = useThemePreset()

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">App Theme</h3>
        <ThemePresetSwitcher />
      </div>

      <div className="flex gap-2 mb-3">
        <div
          className="h-8 w-8 rounded border"
          style={{
            backgroundColor: `hsl(${currentPreset.colors.primary.hue} ${currentPreset.colors.primary.saturation}% ${currentPreset.colors.primary.lightness}%)`,
          }}
        />
        <div className="flex-1">
          <p className="font-medium text-sm">{currentPreset.name}</p>
          <p className="text-xs text-muted-foreground">{currentPreset.mood}</p>
        </div>
        {isCustom && <Badge variant="secondary">Custom</Badge>}
      </div>

      <div className="text-xs text-muted-foreground">
        {currentPreset.description}
      </div>
    </Card>
  )
}

// ============================================================================
// EXPORT ALL EXAMPLES
// ============================================================================

export const themeExamples = {
  BasicPresetSelector,
  DropdownThemeSelector,
  ThemeCardGallery,
  QuickThemeButtons,
  FilteredThemeSelector,
  CurrentThemeInfo,
  TimeBasedThemeSwitcher,
  ThemedCustomCard,
  ThemeSettingsPage,
  TradingStyleThemeRecommender,
  ProgrammaticThemeExample,
  ThemeDashboardWidget,
}
