"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { LogOut } from "lucide-react"
import { SessionItem } from "./session-item"
import type { Session } from "../../types"
import { toast } from "sonner"

interface ActiveSessionsSectionProps {
  sessions: Session[]
  onSessionsChange: (sessions: Session[]) => void
}

export const ActiveSessionsSection: React.FC<ActiveSessionsSectionProps> = ({ sessions, onSessionsChange }) => {
  const [isTerminatingAll, setIsTerminatingAll] = useState(false)

  const handleTerminateSession = async (sessionId: string) => {
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 500))

      onSessionsChange(sessions.filter((session) => session.id !== sessionId))
      toast.success("Session terminated successfully")
    } catch (error) {
      toast.error("Failed to terminate session")
    }
  }

  const handleTerminateAllSessions = async () => {
    setIsTerminatingAll(true)
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Keep only the current session
      const currentSession = sessions.find((session) => session.current)
      onSessionsChange(currentSession ? [currentSession] : [])

      toast.success("All other sessions terminated successfully")
    } catch (error) {
      toast.error("Failed to terminate sessions")
    } finally {
      setIsTerminatingAll(false)
    }
  }

  const otherSessions = sessions.filter((session) => !session.current)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">Active Sessions</h3>
          <p className="text-sm text-muted-foreground">Manage devices that are currently signed in to your account</p>
        </div>

        {otherSessions.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">
                <LogOut className="mr-2 h-4 w-4" />
                Terminate All Others
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Terminate All Other Sessions</AlertDialogTitle>
                <AlertDialogDescription>
                  This will sign out all other devices except this one. You&apos;ll need to sign in again on those devices.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleTerminateAllSessions} disabled={isTerminatingAll}>
                  {isTerminatingAll ? "Terminating..." : "Terminate All"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <div className="space-y-3">
        {sessions.map((session) => (
          <SessionItem key={session.id} session={session} onTerminate={handleTerminateSession} />
        ))}
      </div>

      {sessions.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <p>No active sessions found</p>
        </div>
      )}
    </div>
  )
}
