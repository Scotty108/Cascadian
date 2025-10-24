"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

interface ShortcutConfig {
  key: string
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  action: () => void
  description: string
}

export function useKeyboardShortcuts(shortcuts: ShortcutConfig[]) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      shortcuts.forEach((shortcut) => {
        const ctrlMatch = shortcut.ctrlKey === undefined || shortcut.ctrlKey === e.ctrlKey
        const shiftMatch = shortcut.shiftKey === undefined || shortcut.shiftKey === e.shiftKey
        const altMatch = shortcut.altKey === undefined || shortcut.altKey === e.altKey
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase()

        if (ctrlMatch && shiftMatch && altMatch && keyMatch) {
          e.preventDefault()
          shortcut.action()
        }
      })
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [shortcuts])
}

// Common navigation shortcuts
export function useNavigationShortcuts() {
  const router = useRouter()

  useKeyboardShortcuts([
    {
      key: "h",
      ctrlKey: true,
      action: () => router.push("/dashboard"),
      description: "Go to Dashboard"
    },
    {
      key: "m",
      ctrlKey: true,
      action: () => router.push("/"),
      description: "Go to Market Screener"
    },
    {
      key: "e",
      ctrlKey: true,
      action: () => router.push("/events"),
      description: "Go to Events"
    },
    {
      key: "s",
      ctrlKey: true,
      action: () => router.push("/intelligence-signals"),
      description: "Go to Intelligence Signals"
    },
    {
      key: "w",
      ctrlKey: true,
      action: () => router.push("/insiders"),
      description: "Go to Whale Activity"
    },
    {
      key: "/",
      ctrlKey: true,
      action: () => {
        const searchInput = document.querySelector('input[type="search"]') as HTMLInputElement
        searchInput?.focus()
      },
      description: "Focus search"
    }
  ])
}
