"use client"

import { useEffect } from "react"
import { useTheme } from "next-themes"

/**
 * Component that applies visual settings from localStorage on app load
 * This ensures settings persist across page loads and sessions
 */
export function SettingsApplier() {
  const { setTheme } = useTheme()

  useEffect(() => {
    // Load settings from localStorage
    const savedSettings = localStorage.getItem("CASCADIAN-settings")
    if (!savedSettings) return

    try {
      const settings = JSON.parse(savedSettings)
      const appearance = settings.appearance

      if (!appearance) return

      // Apply theme
      if (appearance.theme) {
        setTheme(appearance.theme)
      }

      const root = document.documentElement

      // Apply density
      if (appearance.density) {
        root.classList.remove('density-compact', 'density-comfortable', 'density-spacious')
        root.classList.add(`density-${appearance.density}`)
      }

      // Apply custom colors
      if (appearance.customColors) {
        root.style.setProperty('--custom-primary-accent', appearance.customColors.primaryAccent)
        root.style.setProperty('--custom-secondary-accent', appearance.customColors.secondaryAccent)
      }

      // Apply accessibility settings
      if (appearance.accessibility) {
        // High contrast
        if (appearance.accessibility.highContrast) {
          root.classList.add('high-contrast')
        } else {
          root.classList.remove('high-contrast')
        }

        // Reduced motion
        if (appearance.accessibility.reducedMotion) {
          root.classList.add('reduce-motion')
        } else {
          root.classList.remove('reduce-motion')
        }

        // Large text
        if (appearance.accessibility.largeText) {
          root.classList.add('large-text')
        } else {
          root.classList.remove('large-text')
        }
      }
    } catch (error) {
      console.error("Failed to apply saved settings:", error)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
