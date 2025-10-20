import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LogLevelBadge } from "../shared/log-level-badge"
import { StatusBadge } from "../shared/status-badge"
import type { ExecutionLog } from "../../types"
import { formatTimestamp, formatDuration } from "../../utils"

interface LogOverviewTabProps {
  log: ExecutionLog
}

export const LogOverviewTab = ({ log }: LogOverviewTabProps) => {
  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Basic Information</CardTitle>
          <CardDescription>Overview of the execution log</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">Log ID</p>
              <p className="text-sm font-mono">{log.id}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Timestamp</p>
              <p className="text-sm">{formatTimestamp(log.timestamp)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Level</p>
              <LogLevelBadge level={log.level} />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Status</p>
              <StatusBadge status={log.status} />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Action</p>
              <p className="text-sm capitalize">{log.action.replace(/_/g, " ")}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Duration</p>
              <p className="text-sm">{log.duration ? formatDuration(log.duration) : "N/A"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bot Info */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Bot Information</CardTitle>
          <CardDescription>Details about the bot that generated this log</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">Bot Name</p>
              <p className="text-sm">{log.botName}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Bot ID</p>
              <p className="text-sm font-mono">{log.botId}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Message */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Message</CardTitle>
          <CardDescription>Log message details</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap">{log.message}</p>
        </CardContent>
      </Card>
    </div>
  )
}
