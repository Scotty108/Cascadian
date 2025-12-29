"use client"

import { useState } from 'react'
import { Check, Palette, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useThemePreset } from '@/components/theme-preset-provider'
import type { ThemePreset } from '@/lib/theme-presets'

interface ThemePresetSwitcherProps {
  className?: string
  showLabel?: boolean
}

export function ThemePresetSwitcher({ className, showLabel = false }: ThemePresetSwitcherProps) {
  const { currentPreset, setPreset, availablePresets, isCustom } = useThemePreset()
  const [open, setOpen] = useState(false)

  const handlePresetSelect = (preset: ThemePreset) => {
    setPreset(preset)
    setOpen(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn('gap-2', showLabel ? 'w-[200px]' : 'w-auto', className)}
          aria-label="Select theme preset"
        >
          <Palette className="h-4 w-4" />
          {showLabel && (
            <span className="truncate">
              {isCustom ? 'Custom Theme' : currentPreset.name}
            </span>
          )}
          {isCustom && <Sparkles className="h-3 w-3 text-muted-foreground" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[320px]">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Theme Presets</span>
          {isCustom && (
            <Badge variant="secondary" className="text-xs">
              Custom
            </Badge>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <div className="max-h-[400px] overflow-y-auto">
          {availablePresets.map((preset) => (
            <DropdownMenuItem
              key={preset.id}
              onClick={() => handlePresetSelect(preset)}
              className="flex flex-col items-start gap-1 cursor-pointer py-3"
            >
              <div className="flex w-full items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="h-4 w-4 rounded-full border"
                    style={{
                      backgroundColor: `hsl(${preset.colors.primary.hue} ${preset.colors.primary.saturation}% ${preset.colors.primary.lightness}%)`,
                    }}
                    aria-hidden="true"
                  />
                  <span className="font-medium">{preset.name}</span>
                </div>
                {!isCustom && currentPreset.id === preset.id && (
                  <Check className="h-4 w-4 text-primary" />
                )}
              </div>
              <p className="text-xs text-muted-foreground pl-6">{preset.description}</p>
              <div className="flex gap-1 pl-6 mt-1">
                {preset.tags?.slice(0, 3).map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px] px-1 py-0">
                    {tag}
                  </Badge>
                ))}
              </div>
            </DropdownMenuItem>
          ))}
        </div>

        {isCustom && (
          <>
            <DropdownMenuSeparator />
            <div className="p-2 text-xs text-muted-foreground">
              You&apos;re using a customized theme. Select a preset to replace your customizations.
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Compact version without label, suitable for toolbars
 */
export function ThemePresetSwitcherCompact({ className }: { className?: string }) {
  return <ThemePresetSwitcher className={className} showLabel={false} />
}

/**
 * Gallery view for theme selection page
 */
export function ThemePresetGallery() {
  const { currentPreset, setPreset, availablePresets, isCustom } = useThemePreset()

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {availablePresets.map((preset) => {
        const isSelected = !isCustom && currentPreset.id === preset.id

        return (
          <button
            key={preset.id}
            onClick={() => setPreset(preset)}
            className={cn(
              'relative rounded-lg border-2 p-4 text-left transition-all hover:shadow-md',
              isSelected
                ? 'border-primary bg-primary/5'
                : 'border-border bg-card hover:border-primary/50'
            )}
          >
            {isSelected && (
              <div className="absolute top-2 right-2">
                <Badge variant="default" className="gap-1">
                  <Check className="h-3 w-3" />
                  Active
                </Badge>
              </div>
            )}

            <div className="space-y-3">
              {/* Color swatches */}
              <div className="flex gap-2">
                <div
                  className="h-12 w-12 rounded-md border"
                  style={{
                    backgroundColor: `hsl(${preset.colors.primary.hue} ${preset.colors.primary.saturation}% ${preset.colors.primary.lightness}%)`,
                  }}
                  aria-label={`${preset.name} primary color`}
                />
                <div
                  className="h-12 w-12 rounded-md border"
                  style={{
                    backgroundColor: `hsl(${preset.colors.accent.hue} ${preset.colors.accent.saturation}% ${preset.colors.accent.lightness}%)`,
                  }}
                  aria-label={`${preset.name} accent color`}
                />
                <div
                  className="h-12 flex-1 rounded-md border"
                  style={{
                    backgroundColor: `hsl(${preset.colors.background.hue} ${preset.colors.background.saturation}% ${preset.colors.background.lightness}%)`,
                  }}
                  aria-label={`${preset.name} background color`}
                />
              </div>

              {/* Theme info */}
              <div>
                <h3 className="font-semibold text-lg">{preset.name}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {preset.description}
                </p>
              </div>

              {/* Mood and use cases */}
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">
                  Mood: <span className="text-foreground">{preset.mood}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {preset.useCases.map((useCase) => (
                    <Badge key={useCase} variant="secondary" className="text-xs">
                      {useCase}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Tags */}
              {preset.tags && (
                <div className="flex flex-wrap gap-1">
                  {preset.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      #{tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
