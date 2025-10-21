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
        <p className="text-muted-foreground">Export, manage, and delete your CASCADIAN data</p>
      </div>

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
              label="Profile & Settings"
              description="Your profile, preferences, and account settings"
              checked={data.export.includePersonalData}
              onCheckedChange={(checked) => handleExportChange("includePersonalData", checked)}
            />

            <SettingsToggle
              id="include-trading"
              label="Watchlists & Tracked Data"
              description="Watched markets, followed wallets, and custom alerts"
              checked={data.export.includeTradingData}
              onCheckedChange={(checked) => handleExportChange("includeTradingData", checked)}
            />

            <SettingsToggle
              id="include-bot"
              label="Strategy Configurations"
              description="Automated strategies, workflows, and performance history"
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
              <h4 className="font-medium">Watchlist Data</h4>
              <p className="text-sm text-muted-foreground">Delete all watchlists for markets and wallets</p>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleDeleteData("Watchlist")}
                disabled={isDeletingData}
              >
                Delete Watchlists
              </Button>
            </div>

            <div className="space-y-2">
              <h4 className="font-medium">Strategy Data</h4>
              <p className="text-sm text-muted-foreground">Delete all strategy configurations and workflows</p>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleDeleteData("Strategy")}
                disabled={isDeletingData}
              >
                Delete Strategies
              </Button>
            </div>

            <div className="space-y-2">
              <h4 className="font-medium">Analysis & Research</h4>
              <p className="text-sm text-muted-foreground">Delete custom analysis, notes, and alerts</p>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleDeleteData("Analysis")}
                disabled={isDeletingData}
              >
                Delete Analysis
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

      {/* API Usage Statistics */}
      <Card>
        <CardHeader>
          <CardTitle>API Usage Statistics</CardTitle>
          <CardDescription>Track your Polymarket API and AI service consumption</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Polymarket API Calls</span>
                <span className="font-mono">24,531 / 100,000</span>
              </div>
              <Progress value={24.5} className="h-2" />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>OpenAI Tokens</span>
                <span className="font-mono">43.2K / 1M</span>
              </div>
              <Progress value={4.3} className="h-2" />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Anthropic Tokens</span>
                <span className="font-mono">31.5K / 1M</span>
              </div>
              <Progress value={3.1} className="h-2" />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Market Data Storage</span>
                <span className="font-mono">142 MB / 5 GB</span>
              </div>
              <Progress value={2.8} className="h-2" />
            </div>

            <div className="pt-2 border-t">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Billing period resets in 18 days</span>
                <span className="text-green-600 font-semibold">Healthy Usage</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
