"use client"

import { FolderOpen, Search, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

interface EmptyStateProps {
  type: "no-logs" | "no-results"
  onReset?: () => void
}

export const EmptyState = ({ type, onReset }: EmptyStateProps) => {
  if (type === "no-logs") {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FolderOpen className="w-12 h-12 text-gray-400 mb-4" />
        <h3 className="text-lg font-medium mb-2">No execution logs found</h3>
        <p className="text-gray-500 mb-6 max-w-md">
          There are no execution logs available. Logs will appear here when your bots start executing trades.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Search className="w-12 h-12 text-gray-400 mb-4" />
      <h3 className="text-lg font-medium mb-2">No matching logs found</h3>
      <p className="text-gray-500 mb-6 max-w-md">
        No logs match your current filter criteria. Try adjusting your filters to see more results.
      </p>
      {onReset && (
        <Button onClick={onReset} variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          Reset Filters
        </Button>
      )}
    </div>
  )
}
