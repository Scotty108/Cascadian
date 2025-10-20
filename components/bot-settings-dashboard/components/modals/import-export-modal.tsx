"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Download, FileText, Loader2 } from "lucide-react"
import type { BotConfig, ImportExportData } from "../../types"

interface ImportExportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bots: BotConfig[]
  onImport: (bots: BotConfig[]) => void
}

export function ImportExportModal({ open, onOpenChange, bots, onImport }: ImportExportModalProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const handleExportJSON = () => {
    const exportData: ImportExportData = {
      bots,
      settings: [],
      exportDate: new Date().toISOString(),
      version: "1.0.0",
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `bot-settings-${new Date().toISOString().split("T")[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleExportCSV = () => {
    const headers = [
      "Name",
      "Type",
      "Status",
      "Exchange",
      "Pair",
      "Strategy",
      "Profitability",
      "Total Trades",
      "Win Rate",
    ]
    const csvContent = [
      headers.join(","),
      ...bots.map((bot) =>
        [
          `"${bot.name}"`,
          bot.type,
          bot.status,
          bot.exchange,
          `"${bot.pair}"`,
          bot.strategy,
          bot.profitability,
          bot.totalTrades,
          bot.winRate,
        ].join(","),
      ),
    ].join("\n")

    const blob = new Blob([csvContent], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `bot-settings-${new Date().toISOString().split("T")[0]}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setIsLoading(true)
    setImportError(null)

    try {
      const text = await file.text()
      const data: ImportExportData = JSON.parse(text)

      if (!data.bots || !Array.isArray(data.bots)) {
        throw new Error("Invalid file format: missing bots array")
      }

      // Validate bot structure
      for (const bot of data.bots) {
        if (!bot.id || !bot.name || !bot.type) {
          throw new Error("Invalid bot data: missing required fields")
        }
      }

      onImport(data.bots)
      onOpenChange(false)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Failed to import file")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Import / Export Bots</DialogTitle>
          <DialogDescription>Backup your bot configurations or import from a previous export.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="export" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="export">Export</TabsTrigger>
            <TabsTrigger value="import">Import</TabsTrigger>
          </TabsList>

          <TabsContent value="export" className="space-y-4">
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <h4 className="font-medium mb-2">Export Summary</h4>
                <p className="text-sm text-muted-foreground">
                  {bots.length} bot{bots.length !== 1 ? "s" : ""} will be exported
                </p>
              </div>

              <div className="space-y-2">
                <Button onClick={handleExportJSON} className="w-full justify-start">
                  <FileText className="mr-2 h-4 w-4" />
                  Export as JSON (Recommended)
                </Button>
                <Button onClick={handleExportCSV} variant="outline" className="w-full justify-start">
                  <Download className="mr-2 h-4 w-4" />
                  Export as CSV (Data Only)
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="import" className="space-y-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="import-file">Select File</Label>
                <Input id="import-file" type="file" accept=".json" onChange={handleFileImport} disabled={isLoading} />
              </div>

              {importError && (
                <div className="p-4 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-800">
                  <p className="text-sm text-red-700 dark:text-red-300">{importError}</p>
                </div>
              )}

              <div className="p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <h4 className="font-medium text-blue-800 dark:text-blue-200 mb-2">Import Notes:</h4>
                <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                  <li>• Only JSON files exported from this app are supported</li>
                  <li>• Imported bots will be added to your existing bots</li>
                  <li>• Duplicate names will be automatically renamed</li>
                  <li>• All imported bots will start in &quot;inactive&quot; status</li>
                </ul>
              </div>

              {isLoading && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  <span>Importing bots...</span>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
