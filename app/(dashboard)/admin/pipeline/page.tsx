"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  RefreshCw,
  Database,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Clock,
  Activity,
  BarChart3,
  Loader2
} from "lucide-react"
import { cn } from "@/lib/utils"

interface TableStats {
  table: string
  rowCount: number
  lastUpdated: string | null
  status: 'healthy' | 'warning' | 'empty'
}

interface PipelineStatus {
  success: boolean
  timestamp: string
  clickhouse: {
    connected: boolean
    tables: TableStats[]
  }
  wallets: {
    total: number
    synced: number
    needsSync: number
    syncRate: number
  }
  dataQuality: {
    tradesRaw: number
    tradesEnriched: number
    enrichmentRate: string
    walletsWithMetrics: number
    metricsRate: string
  }
  pipeline: {
    status: 'not_started' | 'sync_complete' | 'enrichment_complete' | 'complete'
    nextStep: string
  }
}

export default function PipelineDashboard() {
  const [status, setStatus] = useState<PipelineStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/admin/pipeline-status')
      const data = await response.json()
      setStatus(data)
    } catch (error) {
      console.error('Failed to fetch pipeline status:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()
  }, [])

  useEffect(() => {
    if (!autoRefresh) return

    const interval = setInterval(fetchStatus, 10000) // Refresh every 10s
    return () => clearInterval(interval)
  }, [autoRefresh])

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'text-green-600 dark:text-green-400'
      case 'warning': return 'text-yellow-600 dark:text-yellow-400'
      case 'empty': return 'text-gray-600 dark:text-gray-400'
      default: return 'text-gray-600 dark:text-gray-400'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy': return <CheckCircle2 className="h-5 w-5 text-green-600" />
      case 'warning': return <AlertCircle className="h-5 w-5 text-yellow-600" />
      case 'empty': return <AlertCircle className="h-5 w-5 text-gray-600" />
      default: return <AlertCircle className="h-5 w-5 text-gray-600" />
    }
  }

  const formatNumber = (num: number) => {
    return num.toLocaleString()
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never'
    const date = new Date(dateStr)
    return date.toLocaleString()
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (!status || !status.success) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <Card className="border-red-200 dark:border-red-900">
          <CardHeader>
            <CardTitle className="text-red-600">Connection Error</CardTitle>
            <CardDescription>Failed to connect to pipeline services</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={fetchStatus} variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pipeline Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Real-time monitoring of the TSI data pipeline
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={autoRefresh ? "default" : "outline"}>
            {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <Clock className="h-4 w-4 mr-2" />
            {autoRefresh ? 'Disable' : 'Enable'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchStatus}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Pipeline Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Pipeline Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Current Status</p>
                <p className="text-2xl font-bold">
                  {status.pipeline.status === 'complete' ? '✅ Complete' :
                   status.pipeline.status === 'enrichment_complete' ? '⚙️ Enrichment Complete' :
                   status.pipeline.status === 'sync_complete' ? '📊 Sync Complete' :
                   '🚀 Not Started'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Next Step</p>
                <p className="text-lg font-medium">{status.pipeline.nextStep}</p>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Last updated: {formatDate(status.timestamp)}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Wallet Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Wallets</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(status.wallets.total)}</div>
            <p className="text-xs text-muted-foreground">
              Discovered wallets in database
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Synced Wallets</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(status.wallets.synced)}</div>
            <p className="text-xs text-muted-foreground">
              {status.wallets.syncRate.toFixed(1)}% complete
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Needs Sync</CardTitle>
            <Clock className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(status.wallets.needsSync)}</div>
            <p className="text-xs text-muted-foreground">
              Pending sync
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Data Quality */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Data Quality Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Raw Trades</span>
                <span className="font-medium">{formatNumber(status.dataQuality.tradesRaw)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Enriched Trades</span>
                <span className="font-medium">{formatNumber(status.dataQuality.tradesEnriched)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Enrichment Rate</span>
                <Badge variant="outline">{status.dataQuality.enrichmentRate}%</Badge>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Wallets with Metrics</span>
                <span className="font-medium">{formatNumber(status.dataQuality.walletsWithMetrics)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Metrics Coverage</span>
                <Badge variant="outline">{status.dataQuality.metricsRate}%</Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ClickHouse Tables */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            ClickHouse Tables
          </CardTitle>
          <CardDescription>
            {status.clickhouse.connected ? '✅ Connected' : '❌ Disconnected'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {status.clickhouse.tables.map((table) => (
              <div key={table.table} className="flex items-center justify-between border-b pb-3 last:border-0">
                <div className="flex items-center gap-3">
                  {getStatusIcon(table.status)}
                  <div>
                    <p className="font-medium">{table.table}</p>
                    <p className="text-sm text-muted-foreground">
                      Last updated: {formatDate(table.lastUpdated)}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={cn("text-2xl font-bold", getStatusColor(table.status))}>
                    {formatNumber(table.rowCount)}
                  </p>
                  <p className="text-xs text-muted-foreground">rows</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Pipeline Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Manual Pipeline Triggers</CardTitle>
          <CardDescription>
            Run pipeline steps manually (use with caution)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground mb-4">
              For automated pipeline execution, use: <code className="bg-muted px-2 py-1 rounded">npx tsx scripts/run-full-pipeline.ts</code>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled>
                <TrendingUp className="h-4 w-4 mr-2" />
                Bulk Sync (2-4 hours)
              </Button>
              <Button variant="outline" disabled>
                <BarChart3 className="h-4 w-4 mr-2" />
                Enrichment (30-60 min)
              </Button>
              <Button variant="outline" disabled>
                <Activity className="h-4 w-4 mr-2" />
                Calculate Metrics (2-5 min)
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Manual triggers coming soon. For now, run scripts directly from terminal.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
