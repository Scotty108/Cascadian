import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { ExecutionLog } from "../../types"

interface LogDetailsTabProps {
  log: ExecutionLog
}

export const LogDetailsTab = ({ log }: LogDetailsTabProps) => {
  // Format JSON for display
  const formatJson = (obj: any) => {
    return JSON.stringify(obj, null, 2)
  }

  return (
    <div className="space-y-6">
      {/* Raw Data */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Raw Data</CardTitle>
          <CardDescription>Complete log data in JSON format</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[200px] rounded-md border p-4">
            <pre className="text-xs font-mono">{formatJson(log)}</pre>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Error Information (if applicable) */}
      {log.level === "error" && log.details?.error && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Error Information</CardTitle>
            <CardDescription>Details about the error that occurred</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium mb-1">Error Message</h4>
                <p className="text-sm text-red-500">{log.details.error}</p>
              </div>

              {log.details.stackTrace && (
                <div>
                  <h4 className="text-sm font-medium mb-1">Stack Trace</h4>
                  <ScrollArea className="h-[150px] rounded-md border bg-muted p-4">
                    <pre className="text-xs font-mono whitespace-pre-wrap">{log.details.stackTrace}</pre>
                  </ScrollArea>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Metadata */}
      {log.details?.metadata && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Metadata</CardTitle>
            <CardDescription>Additional information associated with this log</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[150px] rounded-md border p-4">
              <pre className="text-xs font-mono">{formatJson(log.details.metadata)}</pre>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
