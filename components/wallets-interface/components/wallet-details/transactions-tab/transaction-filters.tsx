"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { toast } from "@/hooks/use-toast"
import { Search, Download, CalendarIcon, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface TransactionFiltersProps {
  searchTerm?: string
  typeFilter?: string
  statusFilter?: string
  onSearchChange?: (value: string) => void
  onTypeFilterChange?: (value: string) => void
  onStatusFilterChange?: (value: string) => void
}

type ExportFields = {
  hash: boolean
  type: boolean
  amount: boolean
  token: boolean
  status: boolean
  timestamp: boolean
  gasUsed: boolean
  gasFee: boolean
}

type ExportFieldKey = keyof ExportFields

export function TransactionFilters({
  searchTerm = "",
  typeFilter = "all",
  statusFilter = "all",
  onSearchChange = () => {},
  onTypeFilterChange = () => {},
  onStatusFilterChange = () => {},
}: TransactionFiltersProps) {
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportFormat, setExportFormat] = useState<"csv" | "json" | "xlsx">("csv")
  const [exportFields, setExportFields] = useState<ExportFields>({
    hash: true,
    type: true,
    amount: true,
    token: true,
    status: true,
    timestamp: true,
    gasUsed: false,
    gasFee: false,
  })
  const [dateRange, setDateRange] = useState<{
    from: Date | undefined
    to: Date | undefined
  }>({
    from: undefined,
    to: undefined,
  })
  const [isExporting, setIsExporting] = useState(false)

  const clearAllFilters = () => {
    onSearchChange("")
    onTypeFilterChange("all")
    onStatusFilterChange("all")
  }

  const toggleExportField = (field: ExportFieldKey) => {
    setExportFields((prev) => ({
      ...prev,
      [field]: !prev[field],
    }))
  }

  const getActiveFilterCount = () => {
    let count = 0
    if (searchTerm) count++
    if (typeFilter !== "all") count++
    if (statusFilter !== "all") count++
    return count
  }

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  const handleExport = async () => {
    const selectedFields = Object.entries(exportFields)
      .filter(([_, selected]) => selected)
      .map(([field, _]) => field)

    if (selectedFields.length === 0) {
      toast({
        title: "No fields selected",
        description: "Please select at least one field to export.",
        variant: "destructive",
      })
      return
    }

    setIsExporting(true)

    try {
      // Simulate export process
      await new Promise((resolve) => setTimeout(resolve, 2000))

      // Create sample data for export
      const sampleData = [
        {
          hash: "0x1234...5678",
          type: "Send",
          amount: "0.5 ETH",
          token: "ETH",
          status: "Completed",
          timestamp: "2024-01-15 10:30:00",
          gasUsed: "21000",
          gasFee: "0.001 ETH",
        },
        {
          hash: "0x9876...5432",
          type: "Receive",
          amount: "100 USDC",
          token: "USDC",
          status: "Completed",
          timestamp: "2024-01-14 15:45:00",
          gasUsed: "65000",
          gasFee: "0.003 ETH",
        },
      ]

      // Filter data based on selected fields
      const filteredData = sampleData.map((item) => {
        const filtered: any = {}
        selectedFields.forEach((field) => {
          filtered[field] = item[field as keyof typeof item]
        })
        return filtered
      })

      // Create and download file
      let content: string
      let mimeType: string
      let fileName: string

      const currentDate = new Date().toISOString().split("T")[0]

      switch (exportFormat) {
        case "csv":
          const headers = selectedFields.join(",")
          const rows = filteredData
            .map((item) => selectedFields.map((field) => `"${item[field]}"`).join(","))
            .join("\n")
          content = `${headers}\n${rows}`
          mimeType = "text/csv"
          fileName = `transactions_${currentDate}.csv`
          break
        case "json":
          content = JSON.stringify(filteredData, null, 2)
          mimeType = "application/json"
          fileName = `transactions_${currentDate}.json`
          break
        case "xlsx":
          // For demo purposes, we'll create a simple text file
          content = "Excel export would be implemented with a library like xlsx"
          mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          fileName = `transactions_${currentDate}.xlsx`
          break
        default:
          throw new Error("Unsupported format")
      }

      // Create and trigger download
      const blob = new Blob([content], { type: mimeType })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast({
        title: "Export successful",
        description: `Transactions exported as ${exportFormat.toUpperCase()}`,
      })

      setShowExportModal(false)
    } catch (error) {
      toast({
        title: "Export failed",
        description: "There was an error exporting your transactions.",
        variant: "destructive",
      })
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center flex-1">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search transactions..."
              className="w-full sm:w-[200px] pl-8"
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>

          <Select value={typeFilter} onValueChange={onTypeFilterChange}>
            <SelectTrigger className="w-full sm:w-[140px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="send">Send</SelectItem>
              <SelectItem value="receive">Receive</SelectItem>
              <SelectItem value="swap">Swap</SelectItem>
              <SelectItem value="approve">Approve</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={onStatusFilterChange}>
            <SelectTrigger className="w-full sm:w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>

          {getActiveFilterCount() > 0 && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="flex items-center gap-1">
                {getActiveFilterCount()} active
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 hover:bg-transparent"
                  onClick={clearAllFilters}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            </div>
          )}
        </div>

        <Button variant="outline" size="sm" onClick={() => setShowExportModal(true)}>
          <Download className="mr-1 h-4 w-4" />
          Export
        </Button>
      </div>

      <Dialog open={showExportModal} onOpenChange={setShowExportModal}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Export Transactions</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <div className="space-y-2">
              <Label>Export Format</Label>
              <Select value={exportFormat} onValueChange={(value: "csv" | "json" | "xlsx") => setExportFormat(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                  <SelectItem value="xlsx">Excel (XLSX)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Date Range (Optional)</Label>
              <div className="flex gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "flex-1 justify-start text-left font-normal",
                        !dateRange.from && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateRange.from ? formatDate(dateRange.from) : "From date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateRange.from}
                      onSelect={(date) => setDateRange((prev) => ({ ...prev, from: date }))}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "flex-1 justify-start text-left font-normal",
                        !dateRange.to && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateRange.to ? formatDate(dateRange.to) : "To date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateRange.to}
                      onSelect={(date) => setDateRange((prev) => ({ ...prev, to: date }))}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Fields to Export</Label>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(exportFields).map(([field, checked]) => (
                  <div key={field} className="flex items-center space-x-2">
                    <Checkbox
                      id={field}
                      checked={checked}
                      onCheckedChange={() => toggleExportField(field as ExportFieldKey)}
                    />
                    <Label htmlFor={field} className="text-sm font-normal capitalize">
                      {field === "gasUsed" ? "Gas Used" : field === "gasFee" ? "Gas Fee" : field}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowExportModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleExport} disabled={isExporting || Object.values(exportFields).every((v) => !v)}>
                {isExporting ? "Exporting..." : "Export"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
