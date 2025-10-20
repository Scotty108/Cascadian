"use client"

import { ExternalLink, Eye } from "lucide-react"
import { TableCell, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { LogLevelBadge } from "../shared/log-level-badge"
import { StatusBadge } from "../shared/status-badge"
import type { ExecutionLog } from "../../types"
import { formatTimestamp, formatDuration } from "../../utils"

interface LogTableRowProps {
  log: ExecutionLog
  onViewDetails: (log: ExecutionLog) => void
}

export const LogTableRow = ({ log, onViewDetails }: LogTableRowProps) => {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{formatTimestamp(log.timestamp)}</TableCell>
      <TableCell>
        <LogLevelBadge level={log.level} />
      </TableCell>
      <TableCell className="font-medium">{log.botName}</TableCell>
      <TableCell>{log.action.replace(/_/g, " ")}</TableCell>
      <TableCell>
        <StatusBadge status={log.status} />
      </TableCell>
      <TableCell className="max-w-md truncate">{log.message}</TableCell>
      <TableCell className="text-right font-mono">{log.duration ? formatDuration(log.duration) : "-"}</TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" onClick={() => onViewDetails(log)} title="View details">
            <Eye className="h-4 w-4" />
          </Button>
          {log.details?.orderId && (
            <Button variant="ghost" size="icon" asChild title="View on exchange" onClick={(e) => e.stopPropagation()}>
              <a
                href={`https://${log.details.exchange}.com/orders/${log.details.orderId}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}
