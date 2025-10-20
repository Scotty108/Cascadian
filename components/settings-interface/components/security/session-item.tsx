"use client"

import type React from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { LogOut } from "lucide-react"
import type { Session } from "../../types"
import { getDeviceIcon, getBrowserIcon, getRelativeTime } from "../../utils"
import * as Icons from "lucide-react"

interface SessionItemProps {
  session: Session
  onTerminate: (sessionId: string) => void
}

export const SessionItem: React.FC<SessionItemProps> = ({ session, onTerminate }) => {
  const DeviceIcon = Icons[getDeviceIcon(session.device) as keyof typeof Icons] as React.ComponentType<{
    className?: string
  }>
  

  return (
    <div className="flex items-center justify-between p-4 border rounded-lg">
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2">
          <DeviceIcon className="h-5 w-5 text-muted-foreground" />
        </div>

        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="font-medium">{session.device}</span>
            {session.current && (
              <Badge variant="default" className="text-xs">
                Current
              </Badge>
            )}
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <div>
              {session.browser} • {session.os}
            </div>
            <div>
              {session.location} • {session.ip}
            </div>
            <div>Last active: {getRelativeTime(session.lastActive)}</div>
          </div>
        </div>
      </div>

      {!session.current && (
        <Button variant="outline" size="sm" onClick={() => onTerminate(session.id)}>
          <LogOut className="mr-2 h-4 w-4" />
          Terminate
        </Button>
      )}
    </div>
  )
}
