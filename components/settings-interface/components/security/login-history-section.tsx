"use client"

import type React from "react"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AlertTriangle, CheckCircle, Download } from "lucide-react"
import type { LoginHistory } from "../../types"
import { formatDate, formatTime, exportToCsv } from "../../utils"

interface LoginHistorySectionProps {
  loginHistory: LoginHistory[]
}

export const LoginHistorySection: React.FC<LoginHistorySectionProps> = ({ loginHistory }) => {
  const [isExporting, setIsExporting] = useState(false)

  const handleExportHistory = async () => {
    setIsExporting(true)
    try {
      // Simulate processing
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const exportData = loginHistory.map((entry) => ({
        timestamp: entry.timestamp,
        ip: entry.ip,
        location: entry.location,
        device: entry.device,
        success: entry.success ? "Success" : "Failed",
        method: entry.method,
      }))

      exportToCsv(exportData, "login-history")
    } catch (error) {
      console.error("Failed to export login history:", error)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">Login History</h3>
          <p className="text-sm text-muted-foreground">Review recent login attempts to your account</p>
        </div>

        <Button variant="outline" onClick={handleExportHistory} disabled={isExporting}>
          <Download className="mr-2 h-4 w-4" />
          {isExporting ? "Exporting..." : "Export History"}
        </Button>
      </div>

      {loginHistory.length > 0 ? (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date & Time</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Device</TableHead>
                <TableHead>IP Address</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loginHistory.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-medium">{formatDate(entry.timestamp)}</div>
                      <div className="text-sm text-muted-foreground">{formatTime(entry.timestamp)}</div>
                    </div>
                  </TableCell>
                  <TableCell>{entry.location}</TableCell>
                  <TableCell>{entry.device}</TableCell>
                  <TableCell>
                    <code className="text-sm">{entry.ip}</code>
                  </TableCell>
                  <TableCell className="capitalize">{entry.method}</TableCell>
                  <TableCell>
                    <div className="flex items-center space-x-2">
                      {entry.success ? (
                        <>
                          <CheckCircle className="h-4 w-4 text-green-500" />
                          <Badge variant="default" className="bg-green-100 text-green-800">
                            Success
                          </Badge>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="h-4 w-4 text-red-500" />
                          <Badge variant="destructive">Failed</Badge>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          <p>No login history available</p>
        </div>
      )}
    </div>
  )
}
