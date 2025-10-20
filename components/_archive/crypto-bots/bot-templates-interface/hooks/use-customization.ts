"use client"

import { useState } from "react"
import type { CustomizationSettings } from "../types"
import { DEFAULT_CUSTOMIZATION_SETTINGS } from "../constants"

export const useCustomization = () => {
  const [customizationMode, setCustomizationMode] = useState(false)
  const [customizedSettings, setCustomizedSettings] = useState<CustomizationSettings>(DEFAULT_CUSTOMIZATION_SETTINGS)

  const updateCustomizedSetting = (key: keyof CustomizationSettings, value: any) => {
    setCustomizedSettings((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  const resetCustomization = () => {
    setCustomizedSettings(DEFAULT_CUSTOMIZATION_SETTINGS)
    setCustomizationMode(false)
  }

  const toggleCustomizationMode = () => {
    setCustomizationMode(!customizationMode)
  }

  return {
    customizationMode,
    customizedSettings,
    updateCustomizedSetting,
    resetCustomization,
    toggleCustomizationMode,
  }
}
