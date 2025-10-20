"use client"

import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ExportDropdown } from "./export-dropdown"
import { REFRESH_INTERVALS } from "../../constants"

interface DashboardHeaderProps {
  onRefresh: () => void
  isLoading: boolean
  isAutoRefresh: boolean
  onAutoRefreshChange: (enabled: boolean) => void
  refreshInterval: number
  onRefreshIntervalChange: (interval: number) => void
  totalLogs: number
  filteredLogs: number
  onExport: (format: "csv" | "json" | "xlsx") => void
}

export const DashboardHeader = ({
  onRefresh,
  isLoading,
  isAutoRefresh,
  onAutoRefreshChange,
  refreshInterval,
  onRefreshIntervalChange,
  totalLogs,
  filteredLogs,
  onExport,
}: DashboardHeaderProps) => {
  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Execution Logs</h1>
          <p className="text-muted-foreground">
            {filteredLogs === totalLogs
              ? `Showing all ${totalLogs} logs`
              : `Showing ${filteredLogs} of ${totalLogs} logs`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            className="flex items-center gap-1"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>

          <ExportDropdown onExport={onExport} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div className="flex items-center space-x-2">
          <Switch id="auto-refresh" checked={isAutoRefresh} onCheckedChange={onAutoRefreshChange} />
          <Label htmlFor="auto-refresh">Auto-refresh</Label>
        </div>

        {isAutoRefresh && (
          <div className="flex items-center space-x-2">
            <Label htmlFor="refresh-interval">Interval:</Label>
            <Select
              value={refreshInterval.toString()}
              onValueChange={(value) => onRefreshIntervalChange(Number.parseInt(value))}
            >
              <SelectTrigger id="refresh-interval" className="w-[140px]">
                <SelectValue placeholder="Select interval" />
              </SelectTrigger>
              <SelectContent>
                {REFRESH_INTERVALS.map((interval) => (
                  <SelectItem key={interval.value} value={interval.value.toString()}>
                    {interval.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  )
}
