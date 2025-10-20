"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { LogOverviewTab } from "./log-overview-tab"
import { LogDetailsTab } from "./log-details-tab"
import { LogTradeTab } from "./log-trade-tab"
import { LogLevelBadge } from "../shared/log-level-badge"
import { StatusBadge } from "../shared/status-badge"
import type { ExecutionLog } from "../../types"
import { formatTimestamp } from "../../utils"

interface LogDetailModalProps {
  log: ExecutionLog | null
  isOpen: boolean
  onClose: () => void
}

export const LogDetailModal = ({ log, isOpen, onClose }: LogDetailModalProps) => {
  if (!log) return null

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-bold">Execution Log Details</DialogTitle>
            <div className="flex items-center gap-2">
              <LogLevelBadge level={log.level} />
              <StatusBadge status={log.status} />
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-500 mt-2">
            <span className="font-mono">{log.id}</span>
            <span>•</span>
            <span>{formatTimestamp(log.timestamp)}</span>
            <span>•</span>
            <span>{log.botName}</span>
          </div>
        </DialogHeader>

        <div className="flex-1 ">
          <Tabs defaultValue="overview" className="h-full flex flex-col">
            <TabsList className="grid w-full grid-cols-3 flex-shrink-0">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="trade">Trade Info</TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-auto mt-4">
              <TabsContent value="overview" className="mt-0">
                <LogOverviewTab log={log} />
              </TabsContent>

              <TabsContent value="details" className="mt-0">
                <LogDetailsTab log={log} />
              </TabsContent>

              <TabsContent value="trade" className="mt-0">
                <LogTradeTab log={log} />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  )
}
