"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Moon, Sun } from "lucide-react"

export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <div className={cn("h-9 w-20 rounded-full bg-muted", className)} />
  }

  return (
    <div className={cn("flex items-center rounded-full p-1 bg-muted", className)}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setTheme("light")}
        className={cn(
          "h-7 w-7 rounded-full",
          theme === "light" ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
        )}
        aria-label="Light mode"
      >
        <Sun className="h-4 w-4" />
        <span className="sr-only">Light mode</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setTheme("dark")}
        className={cn(
          "h-7 w-7 rounded-full",
          theme === "dark" ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
        )}
        aria-label="Dark mode"
      >
        <Moon className="h-4 w-4" />
        <span className="sr-only">Dark mode</span>
      </Button>
    </div>
  )
}
