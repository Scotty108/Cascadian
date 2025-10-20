"use client"

import { useState, useEffect, useCallback } from "react"

type Theme = "light" | "dark" | "system"

export const useTheme = () => {
  const [theme, setTheme] = useState<Theme>("system")
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light")

  // Get system theme preference
  const getSystemTheme = useCallback((): "light" | "dark" => {
    if (typeof window !== "undefined") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    }
    return "light"
  }, [])

  // Update resolved theme based on current theme setting
  const updateResolvedTheme = useCallback(
    (currentTheme: Theme) => {
      if (currentTheme === "system") {
        setResolvedTheme(getSystemTheme())
      } else {
        setResolvedTheme(currentTheme)
      }
    },
    [getSystemTheme],
  )

  // Load theme from localStorage on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem("defibotx-theme") as Theme
    if (savedTheme && ["light", "dark", "system"].includes(savedTheme)) {
      setTheme(savedTheme)
      updateResolvedTheme(savedTheme)
    } else {
      updateResolvedTheme("system")
    }
  }, [updateResolvedTheme])

  // Listen for system theme changes
  useEffect(() => {
    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
      const handleChange = () => updateResolvedTheme("system")

      mediaQuery.addEventListener("change", handleChange)
      return () => mediaQuery.removeEventListener("change", handleChange)
    }
  }, [theme, updateResolvedTheme])

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement
    root.classList.remove("light", "dark")
    root.classList.add(resolvedTheme)
  }, [resolvedTheme])

  const changeTheme = useCallback(
    (newTheme: Theme) => {
      setTheme(newTheme)
      updateResolvedTheme(newTheme)
      localStorage.setItem("defibotx-theme", newTheme)
    },
    [updateResolvedTheme],
  )

  return {
    theme,
    resolvedTheme,
    changeTheme,
    systemTheme: getSystemTheme(),
  }
}
