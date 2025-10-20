"use client"

import type React from "react"
import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SettingsSelect } from "../shared/settings-select"
import { SettingsToggle } from "../shared/settings-toggle"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Database, Download, Trash2, AlertTriangle, CheckCircle } from "lucide-react"
import type { DataSettings } from "../../types"
import { DATA_RETENTION_OPTIONS, EXPORT_FORMATS } from "../../constants"
import { toast } from "sonner"

interface DataTabProps {
  data: DataSettings
  onDataChange: (updates: Partial<DataSettings>) => void
}

export const DataTab: React.FC<DataTabProps> = ({ data, onDataChange }) => {
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [isDeletingData, setIsDeletingData] = useState(false)

  const handleRetentionChange = (key: keyof DataSettings["retention"], value: number) => {
    onDataChange({
      retention: { ...data.retention, [key]: value },
    })
  }

  const handleExportChange = (key: keyof DataSettings["export"], value: any) => {
    onDataChange({
      export: { ...data.export, [key]: value },
    })
  }

  const handleExportData = async () => {
    setIsExporting(true)
    setExportProgress(0)

    try {
      // Simulate export progress
      for (let i = 0; i <= 100; i += 10) {
        setExportProgress(i)
        await new Promise((resolve) => setTimeout(resolve, 200))
      }

      toast.success("Data export completed successfully")
    } catch (error) {
      toast.error("Failed to export data")
    } finally {
      setIsExporting(false)
      setExportProgress(0)
    }
  }

  const handleDeleteData = async (dataType: string) => {
    setIsDeletingData(true)
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 2000))
      toast.success(`${dataType} data deleted successfully`)
    } catch (error) {
      toast.error(`Failed to delete ${dataType} data`)
    } finally {
      setIsDeletingData(false)
    }
  }

  const getRetentionLabel = (days: number) => {
    const option = DATA_RETENTION_OPTIONS.find((opt) => opt.value === days)
    return option ? option.label : `${days} days`
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Data Management</h2>
        <p className="text-muted-foreground">Manage your data retention, export, and deletion preferences</p>
      </div>

      {/* Data Retention */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Database className="h-5 w-5" />
            <span>Data Retention</span>
          </CardTitle>
          <CardDescription>Configure how long different types of data are stored</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsSelect
            id="trading-history-retention"
            label="Trading History"
            description="How long to keep your trading history and transaction records"
            value={data.retention.tradingHistory.toString()}
            onValueChange={(value) => handleRetentionChange("tradingHistory", Number(value))}
            options={DATA_RETENTION_OPTIONS.map((opt) => ({ value: opt.value.toString(), label: opt.label }))}
          />

          <SettingsSelect
            id="bot-logs-retention"
            label="Bot Logs"
            description="How long to keep bot execution logs and performance data"
            value={data.retention.botLogs.toString()}
            onValueChange={(value) => handleRetentionChange("botLogs", Number(value))}
            options={DATA_RETENTION_OPTIONS.map((opt) => ({ value: opt.value.toString(), label: opt.label }))}
          />

          <SettingsSelect
            id="personal-data-retention"
            label="Personal Data"
            description="How long to keep your personal information and profile data"
            value={data.retention.personalData.toString()}
            onValueChange={(value) => handleRetentionChange("personalData", Number(value))}
            options={DATA_RETENTION_OPTIONS.map((opt) => ({ value: opt.value.toString(), label: opt.label }))}
          />

          <SettingsSelect
            id="analytics-data-retention"
            label="Analytics Data"
            description="How long to keep usage analytics and performance metrics"
            value={data.retention.analyticsData.toString()}
            onValueChange={(value) => handleRetentionChange("analyticsData", Number(value))}
            options={DATA_RETENTION_OPTIONS.map((opt) => ({ value: opt.value.toString(), label: opt.label }))}
          />

          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Data will be automatically deleted after the retention period expires. This action cannot be undone.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Data Export */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Download className="h-5 w-5" />
            <span>Data Export</span>
          </CardTitle>
          <CardDescription>Export your data for backup or migration purposes</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsSelect
            id="export-format"
            label="Export Format"
            description="Choose the format for your data export"
            value={data.export.format}
            onValueChange={(value) => handleExportChange("format", value)}
            options={EXPORT_FORMATS}
          />

          <div className="space-y-3">
            <h4 className="font-medium">Data to Include</h4>

            <SettingsToggle
              id="include-personal"
              label="Personal Data"
              description="Include profile information, settings, and preferences"
              checked={data.export.includePersonalData}
              onCheckedChange={(checked) => handleExportChange("includePersonalData", checked)}
            />

            <SettingsToggle
              id="include-trading"
              label="Trading Data"
              description="Include trading history, orders, and transaction records"
              checked={data.export.includeTradingData}
              onCheckedChange={(checked) => handleExportChange("includeTradingData", checked)}
            />

            <SettingsToggle
              id="include-bot"
              label="Bot Data"
              description="Include bot configurations, logs, and performance data"
              checked={data.export.includeBotData}
              onCheckedChange={(checked) => handleExportChange("includeBotData", checked)}
            />
          </div>

          <div className="space-y-3">
            <Button onClick={handleExportData} disabled={isExporting} className="w-full">
              {isExporting ? "Exporting..." : "Export My Data"}
            </Button>

            {isExporting && (
              <div className="space-y-2">
                <Progress value={exportProgress} className="w-full" />
                <p className="text-sm text-muted-foreground text-center">Exporting data... {exportProgress}%</p>
              </div>
            )}
          </div>

          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              Your exported data will be available for download and automatically deleted from our servers after 7 days.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Data Deletion */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Trash2 className="h-5 w-5" />
            <span>Data Deletion</span>
          </CardTitle>
          <CardDescription>Permanently delete specific types of data from your account</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Warning:</strong> Data deletion is permanent and cannot be undone. Please export your data before
              deletion if you need to keep a copy.
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="font-medium">Trading History</h4>
              <p className="text-sm text-muted-foreground">Delete all trading records and transaction history</p>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleDeleteData("Trading History")}
                disabled={isDeletingData}
              >
                Delete Trading Data
              </Button>
            </div>

            <div className="space-y-2">
              <h4 className="font-medium">Bot Logs</h4>
              <p className="text-sm text-muted-foreground">Delete all bot execution logs and performance data</p>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleDeleteData("Bot Logs")}
                disabled={isDeletingData}
              >
                Delete Bot Data
              </Button>
            </div>

            <div className="space-y-2">
              <h4 className="font-medium">Analytics Data</h4>
              <p className="text-sm text-muted-foreground">Delete usage analytics and performance metrics</p>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleDeleteData("Analytics")}
                disabled={isDeletingData}
              >
                Delete Analytics
              </Button>
            </div>

            <div className="space-y-2">
              <h4 className="font-medium">All Account Data</h4>
              <p className="text-sm text-muted-foreground">Permanently delete your entire account and all data</p>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleDeleteData("Account")}
                disabled={isDeletingData}
              >
                Delete Account
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Storage Usage */}
      <Card>
        <CardHeader>
          <CardTitle>Storage Usage</CardTitle>
          <CardDescription>Overview of your current data storage usage</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Trading Data</span>
                <span>2.3 GB</span>
              </div>
              <Progress value={65} className="h-2" />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Bot Logs</span>
                <span>1.8 GB</span>
              </div>
              <Progress value={45} className="h-2" />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Personal Data</span>
                <span>125 MB</span>
              </div>
              <Progress value={15} className="h-2" />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Analytics</span>
                <span>890 MB</span>
              </div>
              <Progress value={25} className="h-2" />
            </div>

            <div className="pt-2 border-t">
              <div className="flex justify-between font-medium">
                <span>Total Usage</span>
                <span>5.1 GB / 10 GB</span>
              </div>
              <Progress value={51} className="h-3 mt-2" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Data Management Summary</CardTitle>
          <CardDescription>Current retention settings overview</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{getRetentionLabel(data.retention.tradingHistory)}</div>
              <div className="text-sm text-muted-foreground">Trading History</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{getRetentionLabel(data.retention.botLogs)}</div>
              <div className="text-sm text-muted-foreground">Bot Logs</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">{getRetentionLabel(data.retention.personalData)}</div>
              <div className="text-sm text-muted-foreground">Personal Data</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">{data.export.format.toUpperCase()}</div>
              <div className="text-sm text-muted-foreground">Export Format</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
