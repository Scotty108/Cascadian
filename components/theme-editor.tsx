"use client"

import { useState, useEffect, useRef } from "react"
import { Palette, X, RotateCcw, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { themePresets, themePresetToConfig, type ThemePreset } from "@/lib/theme-presets"

// Default theme values based on current design system
const DEFAULT_THEME = {
  // Colors
  primaryHue: 217.2,
  primarySaturation: 91.2,
  primaryLightness: 59.8,
  accentHue: 240,
  accentSaturation: 4.8,
  accentLightness: 95.9,

  // Spacing
  radiusBase: 0.5, // rem
  spacingScale: 1.0, // multiplier

  // Typography
  baseFontSize: 16, // px
  headingScale: 1.5,
  bodyLineHeight: 1.5,
}

type ThemeConfig = typeof DEFAULT_THEME

interface ThemeEditorProps {
  className?: string
}

export function ThemeEditor({ className }: ThemeEditorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [theme, setTheme] = useState<ThemeConfig>(DEFAULT_THEME)
  const [mounted, setMounted] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // Load theme from localStorage on mount
  useEffect(() => {
    setMounted(true)
    const savedTheme = localStorage.getItem('cascadian-theme-config')
    if (savedTheme) {
      try {
        setTheme(JSON.parse(savedTheme))
      } catch (e) {
        console.error('Failed to parse saved theme:', e)
      }
    }
  }, [])

  // Apply theme changes to CSS variables
  useEffect(() => {
    if (!mounted) return

    const root = document.documentElement

    // Apply primary color
    root.style.setProperty('--primary', `${theme.primaryHue} ${theme.primarySaturation}% ${theme.primaryLightness}%`)
    root.style.setProperty('--ring', `${theme.primaryHue} ${theme.primarySaturation}% ${theme.primaryLightness}%`)

    // Apply accent color
    root.style.setProperty('--accent', `${theme.accentHue} ${theme.accentSaturation}% ${theme.accentLightness}%`)

    // Apply spacing
    root.style.setProperty('--radius', `${theme.radiusBase}rem`)
    root.style.setProperty('--spacing-scale', `${theme.spacingScale}`)

    // Apply typography
    root.style.setProperty('--base-font-size', `${theme.baseFontSize}px`)
    root.style.setProperty('--heading-scale', `${theme.headingScale}`)
    root.style.setProperty('--body-line-height', `${theme.bodyLineHeight}`)

    // Save to localStorage
    localStorage.setItem('cascadian-theme-config', JSON.stringify(theme))
  }, [theme, mounted])

  // Close panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  const updateTheme = (key: keyof ThemeConfig, value: number) => {
    setTheme(prev => ({ ...prev, [key]: value }))
  }

  const resetTheme = () => {
    setTheme(DEFAULT_THEME)
  }

  const applyPreset = (preset: ThemePreset) => {
    const config = themePresetToConfig(preset)
    setTheme(config)
    // Save preset ID for tracking
    localStorage.setItem('cascadian-theme-preset-id', preset.id)
  }

  const hslToHex = (h: number, s: number, l: number): string => {
    l /= 100
    const a = s * Math.min(l, 1 - l) / 100
    const f = (n: number) => {
      const k = (n + h / 30) % 12
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
      return Math.round(255 * color).toString(16).padStart(2, '0')
    }
    return `#${f(0)}${f(8)}${f(4)}`
  }

  const hexToHsl = (hex: string): { h: number; s: number; l: number } => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    if (!result) return { h: 0, s: 0, l: 0 }

    let r = parseInt(result[1], 16) / 255
    let g = parseInt(result[2], 16) / 255
    let b = parseInt(result[3], 16) / 255

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    let h = 0
    let s = 0
    let l = (max + min) / 2

    if (max !== min) {
      const d = max - min
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      switch (max) {
        case r:
          h = ((g - b) / d + (g < b ? 6 : 0)) / 6
          break
        case g:
          h = ((b - r) / d + 2) / 6
          break
        case b:
          h = ((r - g) / d + 4) / 6
          break
      }
    }

    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      l: Math.round(l * 100),
    }
  }

  const handleColorChange = (type: 'primary' | 'accent', hex: string) => {
    const { h, s, l } = hexToHsl(hex)
    if (type === 'primary') {
      setTheme(prev => ({
        ...prev,
        primaryHue: h,
        primarySaturation: s,
        primaryLightness: l,
      }))
    } else {
      setTheme(prev => ({
        ...prev,
        accentHue: h,
        accentSaturation: s,
        accentLightness: l,
      }))
    }
  }

  if (!mounted) return null

  return (
    <div className={cn("relative", className)} ref={panelRef}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={() => setIsOpen(true)}
        className={cn(
          "h-9 w-9 transition-colors",
          isOpen && "bg-accent"
        )}
        aria-label="Open theme editor"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <Palette className="h-4 w-4" />
      </Button>

      {isOpen && (
        <div
          className="absolute right-0 top-12 z-50 w-[400px] rounded-lg border bg-popover p-6 text-popover-foreground shadow-lg"
          role="dialog"
          aria-label="Theme editor panel"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Theme Editor</h2>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={resetTheme}
                className="h-8 w-8"
                aria-label="Reset theme to defaults"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsOpen(false)}
                className="h-8 w-8"
                aria-label="Close theme editor"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <Tabs defaultValue="presets" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="presets">Presets</TabsTrigger>
              <TabsTrigger value="colors">Colors</TabsTrigger>
              <TabsTrigger value="spacing">Spacing</TabsTrigger>
              <TabsTrigger value="typography">Typography</TabsTrigger>
            </TabsList>

            <TabsContent value="presets" className="space-y-3 mt-4">
              <p className="text-sm text-muted-foreground">
                Choose from curated theme presets designed for different moods and use cases.
              </p>
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                {themePresets.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => applyPreset(preset)}
                    className="w-full text-left rounded-lg border p-3 hover:border-primary hover:bg-accent/50 transition-all"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex gap-1 pt-1">
                        <div
                          className="h-6 w-6 rounded border"
                          style={{
                            backgroundColor: `hsl(${preset.colors.primary.hue} ${preset.colors.primary.saturation}% ${preset.colors.primary.lightness}%)`,
                          }}
                          aria-hidden="true"
                        />
                        <div
                          className="h-6 w-6 rounded border"
                          style={{
                            backgroundColor: `hsl(${preset.colors.accent.hue} ${preset.colors.accent.saturation}% ${preset.colors.accent.lightness}%)`,
                          }}
                          aria-hidden="true"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-sm">{preset.name}</h4>
                          {preset.tags?.slice(0, 2).map((tag) => (
                            <Badge key={tag} variant="outline" className="text-[10px] px-1 py-0">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {preset.description}
                        </p>
                        <p className="text-xs font-medium mt-1">
                          <span className="text-muted-foreground">Mood:</span> {preset.mood}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="colors" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="primary-color">Primary Color</Label>
                <div className="flex gap-2">
                  <Input
                    id="primary-color"
                    type="color"
                    value={hslToHex(theme.primaryHue, theme.primarySaturation, theme.primaryLightness)}
                    onChange={(e) => handleColorChange('primary', e.target.value)}
                    className="w-16 h-10 p-1 cursor-pointer"
                    aria-label="Primary color picker"
                  />
                  <Input
                    type="text"
                    value={hslToHex(theme.primaryHue, theme.primarySaturation, theme.primaryLightness)}
                    onChange={(e) => handleColorChange('primary', e.target.value)}
                    className="flex-1 font-mono"
                    aria-label="Primary color hex value"
                  />
                </div>
                <div className="space-y-2 mt-2">
                  <div>
                    <Label htmlFor="primary-hue" className="text-xs">Hue: {Math.round(theme.primaryHue)}°</Label>
                    <Slider
                      id="primary-hue"
                      value={[theme.primaryHue]}
                      onValueChange={([value]) => updateTheme('primaryHue', value)}
                      min={0}
                      max={360}
                      step={1}
                      className="mt-1"
                      aria-label="Primary color hue"
                    />
                  </div>
                  <div>
                    <Label htmlFor="primary-saturation" className="text-xs">Saturation: {Math.round(theme.primarySaturation)}%</Label>
                    <Slider
                      id="primary-saturation"
                      value={[theme.primarySaturation]}
                      onValueChange={([value]) => updateTheme('primarySaturation', value)}
                      min={0}
                      max={100}
                      step={1}
                      className="mt-1"
                      aria-label="Primary color saturation"
                    />
                  </div>
                  <div>
                    <Label htmlFor="primary-lightness" className="text-xs">Lightness: {Math.round(theme.primaryLightness)}%</Label>
                    <Slider
                      id="primary-lightness"
                      value={[theme.primaryLightness]}
                      onValueChange={([value]) => updateTheme('primaryLightness', value)}
                      min={0}
                      max={100}
                      step={1}
                      className="mt-1"
                      aria-label="Primary color lightness"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="accent-color">Accent Color</Label>
                <div className="flex gap-2">
                  <Input
                    id="accent-color"
                    type="color"
                    value={hslToHex(theme.accentHue, theme.accentSaturation, theme.accentLightness)}
                    onChange={(e) => handleColorChange('accent', e.target.value)}
                    className="w-16 h-10 p-1 cursor-pointer"
                    aria-label="Accent color picker"
                  />
                  <Input
                    type="text"
                    value={hslToHex(theme.accentHue, theme.accentSaturation, theme.accentLightness)}
                    onChange={(e) => handleColorChange('accent', e.target.value)}
                    className="flex-1 font-mono"
                    aria-label="Accent color hex value"
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="spacing" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="border-radius">
                  Border Radius: {theme.radiusBase.toFixed(2)}rem
                </Label>
                <Slider
                  id="border-radius"
                  value={[theme.radiusBase]}
                  onValueChange={([value]) => updateTheme('radiusBase', value)}
                  min={0}
                  max={2}
                  step={0.05}
                  className="mt-1"
                  aria-label="Border radius"
                />
                <div className="flex gap-2 mt-2">
                  <div className="flex-1 h-16 bg-primary rounded-sm" style={{ borderRadius: `${theme.radiusBase * 0.5}rem` }} />
                  <div className="flex-1 h-16 bg-primary rounded-md" style={{ borderRadius: `${theme.radiusBase}rem` }} />
                  <div className="flex-1 h-16 bg-primary rounded-lg" style={{ borderRadius: `${theme.radiusBase * 1.5}rem` }} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="spacing-scale">
                  Spacing Scale: {theme.spacingScale.toFixed(2)}x
                </Label>
                <Slider
                  id="spacing-scale"
                  value={[theme.spacingScale]}
                  onValueChange={([value]) => updateTheme('spacingScale', value)}
                  min={0.5}
                  max={2}
                  step={0.05}
                  className="mt-1"
                  aria-label="Spacing scale multiplier"
                />
                <p className="text-xs text-muted-foreground">
                  Affects padding, margins, and gaps throughout the app
                </p>
              </div>
            </TabsContent>

            <TabsContent value="typography" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="base-font-size">
                  Base Font Size: {theme.baseFontSize}px
                </Label>
                <Slider
                  id="base-font-size"
                  value={[theme.baseFontSize]}
                  onValueChange={([value]) => updateTheme('baseFontSize', value)}
                  min={12}
                  max={20}
                  step={1}
                  className="mt-1"
                  aria-label="Base font size"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="heading-scale">
                  Heading Scale: {theme.headingScale.toFixed(2)}x
                </Label>
                <Slider
                  id="heading-scale"
                  value={[theme.headingScale]}
                  onValueChange={([value]) => updateTheme('headingScale', value)}
                  min={1}
                  max={2.5}
                  step={0.05}
                  className="mt-1"
                  aria-label="Heading font size scale"
                />
                <div className="space-y-1 mt-2">
                  <p style={{ fontSize: `${theme.baseFontSize * theme.headingScale}px` }} className="font-semibold">
                    Heading Preview
                  </p>
                  <p style={{ fontSize: `${theme.baseFontSize}px` }}>
                    Body text preview
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="body-line-height">
                  Line Height: {theme.bodyLineHeight.toFixed(2)}
                </Label>
                <Slider
                  id="body-line-height"
                  value={[theme.bodyLineHeight]}
                  onValueChange={([value]) => updateTheme('bodyLineHeight', value)}
                  min={1}
                  max={2}
                  step={0.05}
                  className="mt-1"
                  aria-label="Body text line height"
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  )
}
