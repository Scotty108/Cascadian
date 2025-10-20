"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FileText, Table, FileSpreadsheet, FileJson, CalendarIcon } from "lucide-react"
import { toast } from "@/hooks/use-toast"
import type { DateRange } from "react-day-picker"
import { addDays, format } from "date-fns"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface ExportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ExportOptions {
  format: "csv" | "excel" | "pdf" | "json"
  dateRange: DateRange | undefined
  includeAssets: boolean
  includeTransactions: boolean
  includeDefiPositions: boolean
  includeNfts: boolean
  includeAnalytics: boolean
}

export function ExportModal({ open, onOpenChange }: ExportModalProps) {
  const [options, setOptions] = useState<ExportOptions>({
    format: "csv",
    dateRange: {
      from: addDays(new Date(), -30),
      to: new Date(),
    },
    includeAssets: true,
    includeTransactions: true,
    includeDefiPositions: true,
    includeNfts: false,
    includeAnalytics: false,
  })
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)

  const formatIcons = {
    csv: Table,
    excel: FileSpreadsheet,
    pdf: FileText,
    json: FileJson,
  }

  const formatLabels = {
    csv: "CSV",
    excel: "Excel",
    pdf: "PDF Report",
    json: "JSON",
  }

  const estimateFileSize = () => {
    let size = 0
    if (options.includeAssets) size += 50
    if (options.includeTransactions) size += 200
    if (options.includeDefiPositions) size += 100
    if (options.includeNfts) size += 150
    if (options.includeAnalytics) size += 300

    return `~${size}KB`
  }

  const generateCSV = (data: any[], filename: string) => {
    if (data.length === 0) return

    const headers = Object.keys(data[0])
    const csvContent = [
      headers.join(","),
      ...data.map((row) =>
        headers
          .map((header) => {
            const value = row[header]
            return typeof value === "string" && value.includes(",") ? `"${value}"` : value
          })
          .join(","),
      ),
    ].join("\n")

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const link = document.createElement("a")
    const url = URL.createObjectURL(blob)
    link.setAttribute("href", url)
    link.setAttribute("download", filename)
    link.style.visibility = "hidden"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const generateExcel = async (data: any[], filename: string) => {
    // In a real app, you'd use a library like xlsx
    toast({
      title: "Excel export",
      description: "Excel export functionality requires additional libraries. Falling back to CSV.",
    })
    generateCSV(data, filename.replace(".xlsx", ".csv"))
  }

  const generatePDF = async (data: any[], filename: string) => {
    // In a real app, you'd use a library like jsPDF
    toast({
      title: "PDF export",
      description: "PDF export functionality requires additional libraries. Falling back to CSV.",
    })
    generateCSV(data, filename.replace(".pdf", ".csv"))
  }

  const generateJSON = (data: any[], filename: string) => {
    const jsonContent = JSON.stringify(data, null, 2)
    const blob = new Blob([jsonContent], { type: "application/json;charset=utf-8;" })
    const link = document.createElement("a")
    const url = URL.createObjectURL(blob)
    link.setAttribute("href", url)
    link.setAttribute("download", filename)
    link.style.visibility = "hidden"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleExport = async () => {
    setIsExporting(true)
    setExportProgress(0)

    try {
      // Simulate export progress
      const progressSteps = [20, 40, 60, 80, 100]
      for (const step of progressSteps) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        setExportProgress(step)
      }

      // Generate mock data based on selected options
      const exportData: any[] = []

      if (options.includeAssets) {
        exportData.push({
          type: "asset",
          name: "Bitcoin",
          symbol: "BTC",
          holdings: 0.76,
          value: 32550.91,
          price: 42830.15,
          change24h: 2.34,
          date: new Date().toISOString(),
        })
        exportData.push({
          type: "asset",
          name: "Ethereum",
          symbol: "ETH",
          holdings: 5.23,
          value: 20346.9,
          price: 3890.42,
          change24h: 1.87,
          date: new Date().toISOString(),
        })
      }

      if (options.includeTransactions) {
        exportData.push({
          type: "transaction",
          asset: "Bitcoin",
          action: "Buy",
          amount: 0.25,
          price: 43000,
          value: 10750,
          date: "2023-05-15",
          status: "Completed",
        })
      }

      if (options.includeDefiPositions) {
        exportData.push({
          type: "defi_position",
          protocol: "Aave",
          asset: "ETH",
          amount: 1.5,
          value: 5835.63,
          apy: 3.2,
          rewards: 186.74,
          date: new Date().toISOString(),
        })
      }

      const timestamp = new Date().toISOString().split("T")[0]
      const filename = `portfolio_export_${timestamp}`

      // Generate file based on format
      switch (options.format) {
        case "csv":
          generateCSV(exportData, `${filename}.csv`)
          break
        case "excel":
          await generateExcel(exportData, `${filename}.xlsx`)
          break
        case "pdf":
          await generatePDF(exportData, `${filename}.pdf`)
          break
        case "json":
          generateJSON(exportData, `${filename}.json`)
          break
      }

      toast({
        title: "Export completed",
        description: `Your portfolio data has been exported as ${formatLabels[options.format]}.`,
      })

      onOpenChange(false)
    } catch (error) {
      toast({
        title: "Export failed",
        description: "Failed to export portfolio data. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsExporting(false)
      setExportProgress(0)
    }
  }

  const Icon = formatIcons[options.format]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Export Portfolio Data</DialogTitle>
          <DialogDescription>Export your portfolio data in various formats for analysis or backup.</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Export Format</CardTitle>
              <CardDescription>Choose the format for your exported data</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                {Object.entries(formatLabels).map(([format, label]) => {
                  const FormatIcon = formatIcons[format as keyof typeof formatIcons]
                  return (
                    <Button
                      key={format}
                      variant={options.format === format ? "default" : "outline"}
                      className="h-16 flex-col gap-2"
                      onClick={() => setOptions((prev) => ({ ...prev, format: format as any }))}
                    >
                      <FormatIcon className="h-5 w-5" />
                      {label}
                    </Button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Date Range</CardTitle>
              <CardDescription>Select the date range for your export</CardDescription>
            </CardHeader>
            <CardContent>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {options.dateRange?.from ? (
                      options.dateRange.to ? (
                        <>
                          {format(options.dateRange.from, "LLL dd, y")} - {format(options.dateRange.to, "LLL dd, y")}
                        </>
                      ) : (
                        format(options.dateRange.from, "LLL dd, y")
                      )
                    ) : (
                      <span>Pick a date range</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    initialFocus
                    mode="range"
                    defaultMonth={options.dateRange?.from}
                    selected={options.dateRange}
                    onSelect={(dateRange) => setOptions((prev) => ({ ...prev, dateRange }))}
                    numberOfMonths={2}
                  />
                </PopoverContent>
              </Popover>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Data to Include</CardTitle>
              <CardDescription>Choose which data to include in your export</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="assets"
                  checked={options.includeAssets}
                  onCheckedChange={(checked) => setOptions((prev) => ({ ...prev, includeAssets: !!checked }))}
                />
                <Label htmlFor="assets">Assets & Holdings</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="transactions"
                  checked={options.includeTransactions}
                  onCheckedChange={(checked) => setOptions((prev) => ({ ...prev, includeTransactions: !!checked }))}
                />
                <Label htmlFor="transactions">Transaction History</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="defi"
                  checked={options.includeDefiPositions}
                  onCheckedChange={(checked) => setOptions((prev) => ({ ...prev, includeDefiPositions: !!checked }))}
                />
                <Label htmlFor="defi">DeFi Positions</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="nfts"
                  checked={options.includeNfts}
                  onCheckedChange={(checked) => setOptions((prev) => ({ ...prev, includeNfts: !!checked }))}
                />
                <Label htmlFor="nfts">NFT Collections</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="analytics"
                  checked={options.includeAnalytics}
                  onCheckedChange={(checked) => setOptions((prev) => ({ ...prev, includeAnalytics: !!checked }))}
                />
                <Label htmlFor="analytics">Analytics & Performance</Label>
              </div>
            </CardContent>
          </Card>

          {isExporting && (
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Exporting data...</span>
                    <span>{exportProgress}%</span>
                  </div>
                  <Progress value={exportProgress} />
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-muted-foreground">Estimated file size: {estimateFileSize()}</div>
            <div className="flex space-x-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExporting}>
                Cancel
              </Button>
              <Button onClick={handleExport} disabled={isExporting}>
                <Icon className="mr-2 h-4 w-4" />
                {isExporting ? "Exporting..." : "Export Data"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
