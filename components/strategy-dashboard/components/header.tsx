"use client"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { Clock, Workflow, Play, Pause, RefreshCw, Edit } from "lucide-react"
import Link from "next/link"

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
  return (
    <>
      {/* Header section */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Workflow className="h-6 w-6" />
            <span>{strategyName}</span>
          </h1>
          <p className="text-muted-foreground">{strategyDescription}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={onRefresh} disabled={isRefreshing}>
                  <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Refresh data</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Button variant="outline" className="gap-2" asChild>
            <Link href={`/strategy-builder?edit=${strategyId}`}>
              <Edit className="h-4 w-4" />
              <span>Edit Strategy</span>
            </Link>
          </Button>

          <Button
            variant={strategyRunning ? "default" : "secondary"}
            className="gap-2"
            onClick={onToggleStrategyStatus}
          >
            {strategyRunning ? (
              <>
                <Pause className="h-4 w-4" />
                <span>Pause Strategy</span>
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                <span>Start Strategy</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Status indicator */}
      <div className="flex items-center gap-2 text-sm">
        <div
          className={cn(
            "h-2 w-2 rounded-full",
            strategyRunning ? "bg-green-500" : "bg-gray-500"
          )}
        />
        <span>
          Status: <span className="font-medium">{strategyRunning ? "Active" : "Paused"}</span>
        </span>

        {strategyRunning && runTime && (
          <>
            <Separator orientation="vertical" className="h-4" />
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Running for: {runTime}</span>
          </>
        )}
      </div>
    </>
  )
}
