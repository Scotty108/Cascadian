"use client"

import Link from "next/link"
import { useMemo } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { Clock, Edit, Pause, Play, RefreshCw, Workflow } from "lucide-react"

import { ACCENT_COLOR } from "../utils"

interface HeaderProps {
  strategyId: string
  strategyName: string
  strategyDescription: string
  strategyRunning: boolean
  isRefreshing: boolean
  runTime?: string
  onToggleStrategyStatus: () => void
  onRefresh: () => void
}

const STATUS_COPY = {
  active: { label: "Active", tone: "Stable runtime" },
  paused: { label: "Paused", tone: "Standing by" },
  inactive: { label: "Inactive", tone: "Not scheduled" },
} as const

export function Header({
  strategyId,
  strategyName,
  strategyDescription,
  strategyRunning,
  isRefreshing,
  runTime,
  onToggleStrategyStatus,
  onRefresh,
}: HeaderProps) {
  const statusLabel = strategyRunning ? STATUS_COPY.active : STATUS_COPY.paused

  const statusTone = strategyRunning
    ? "text-[#00E0AA]"
    : "text-muted-foreground"

  const runtimeCopy = useMemo(() => {
    if (!runTime) {
      return "Runtime tracking enabled"
    }

    return strategyRunning ? `Live for ${runTime}` : `Last run spanned ${runTime}`
  }, [runTime, strategyRunning])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="border-transparent bg-black/5 text-xs uppercase tracking-wide dark:bg-white/10">
              #{strategyId}
            </Badge>
            <span className="hidden sm:inline-block">Strategy ID</span>
          </div>
          <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#00E0AA]/10 text-[#00E0AA]">
              <Workflow className="h-5 w-5" />
            </span>
            <span className="leading-tight">{strategyName}</span>
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">{strategyDescription}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onRefresh}
                  disabled={isRefreshing}
                  className="h-10 w-10 rounded-full border border-border/60 bg-background/60 backdrop-blur transition hover:border-[#00E0AA]/60 hover:text-[#00E0AA]"
                >
                  <RefreshCw
                    className={cn(
                      "h-4 w-4",
                      isRefreshing && "animate-spin text-[#00E0AA]"
                    )}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent sideOffset={8}>
                <p>{isRefreshing ? "Refreshing…" : "Refresh performance data"}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Button
            variant="outline"
            className="gap-2 rounded-full border-border/60 bg-background/60 px-4 py-2 text-sm font-medium transition hover:border-[#00E0AA]/60 hover:text-[#00E0AA]"
            asChild
          >
            <Link href={`/strategy-builder?edit=${strategyId}`}>
              <Edit className="h-4 w-4" />
              Edit strategy
            </Link>
          </Button>

          <Button
            onClick={onToggleStrategyStatus}
            className="gap-2 rounded-full border-0 bg-[#00E0AA] px-5 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-[#00E0AA]/30 transition hover:bg-[#00E0AA]/85 focus-visible:ring-offset-0"
          >
            {strategyRunning ? (
              <>
                <Pause className="h-4 w-4" />
                Pause strategy
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Start strategy
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/50 bg-background/60 px-4 py-3 text-sm shadow-sm">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-2 w-2 rounded-full transition",
              strategyRunning ? "bg-[#00E0AA]" : "bg-muted-foreground/60"
            )}
          />
          <span className={cn("font-medium", statusTone)}>{statusLabel.label}</span>
          <span className="hidden text-muted-foreground sm:inline">• {statusLabel.tone}</span>
        </div>

        <Separator orientation="vertical" className="hidden h-4 sm:block" />

        <div className="flex items-center gap-2 text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span>{runtimeCopy}</span>
        </div>

        <Separator orientation="vertical" className="hidden h-4 sm:block" />

        <div className="flex items-center gap-2 text-muted-foreground">
          <span
            className="inline-flex items-center gap-2 rounded-full border border-[#00E0AA]/30 bg-[#00E0AA]/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-[#00E0AA]"
            style={{
              boxShadow: `inset 0 0 0 1px ${ACCENT_COLOR}29`,
            }}
          >
            Adaptive automation
          </span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            AI monitors market signals in real-time
          </span>
        </div>
      </div>
    </div>
  )
}
