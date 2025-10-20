"use client"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Pause, Play, RefreshCw } from "lucide-react"

interface DashboardHeaderProps {
  botActive: boolean
  onToggleBot: () => void
 
}

export function DashboardHeader({ botActive, onToggleBot,  }: DashboardHeaderProps) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Signal Bot</h1>
        <p className="text-muted-foreground">Manage your crypto trading signals and automate your trades</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant={botActive ? "default" : "outline"} onClick={onToggleBot} className="gap-2">
          {botActive ? (
            <>
              <Pause className="h-4 w-4" /> Pause Bot
            </>
          ) : (
            <>
              <Play className="h-4 w-4" /> Start Bot
            </>
          )}
        </Button>
       
      </div>
    </div>
  )
}
