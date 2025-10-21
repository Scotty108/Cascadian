"use client"

import React, { createContext, useContext, useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import type { ThemePreset } from '@/lib/theme-presets'
import { defaultTheme, themePresets, applyThemePreset, themePresetToConfig } from '@/lib/theme-presets'

interface ThemePresetContextType {
  currentPreset: ThemePreset
  setPreset: (preset: ThemePreset) => void
  availablePresets: ThemePreset[]
  isCustom: boolean
  resetToPreset: (presetId: string) => void
}

const ThemePresetContext = createContext<ThemePresetContextType | undefined>(undefined)

export function ThemePresetProvider({ children }: { children: React.ReactNode }) {
  const { theme: colorMode } = useTheme() // 'light' or 'dark'
  const [currentPreset, setCurrentPreset] = useState<ThemePreset>(defaultTheme)
  const [isCustom, setIsCustom] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Load saved preset from localStorage on mount
  useEffect(() => {
    setMounted(true)
    const savedPresetId = localStorage.getItem('cascadian-theme-preset-id')
    const savedCustomTheme = localStorage.getItem('cascadian-theme-config')

    if (savedPresetId) {
      const preset = themePresets.find(p => p.id === savedPresetId)
      if (preset) {
        setCurrentPreset(preset)
        applyThemePreset(preset, colorMode === 'dark')
        setIsCustom(false)
      }
    } else if (savedCustomTheme) {
      // User has customized the theme
      setIsCustom(true)
    }
  }, [])

  // Re-apply theme when color mode changes (light/dark)
  useEffect(() => {
    if (mounted && !isCustom) {
      applyThemePreset(currentPreset, colorMode === 'dark')
    }
  }, [colorMode, currentPreset, isCustom, mounted])

  const setPreset = (preset: ThemePreset) => {
    setCurrentPreset(preset)
    setIsCustom(false)
    applyThemePreset(preset, colorMode === 'dark')

    // Save to localStorage
    localStorage.setItem('cascadian-theme-preset-id', preset.id)

    // Also save as theme config for compatibility with ThemeEditor
    const config = themePresetToConfig(preset)
    localStorage.setItem('cascadian-theme-config', JSON.stringify(config))
  }

  const resetToPreset = (presetId: string) => {
    const preset = themePresets.find(p => p.id === presetId)
    if (preset) {
      setPreset(preset)
    }
  }

  const value: ThemePresetContextType = {
    currentPreset,
    setPreset,
    availablePresets: themePresets,
    isCustom,
    resetToPreset,
  }

  return (
    <ThemePresetContext.Provider value={value}>
      {children}
    </ThemePresetContext.Provider>
  )
}

export function useThemePreset() {
  const context = useContext(ThemePresetContext)
  if (context === undefined) {
    throw new Error('useThemePreset must be used within a ThemePresetProvider')
  }
  return context
}
