"use client"

import { Button } from "@/components/ui/button"
import { Search } from "lucide-react"

interface EmptyStateProps {
  onResetFilters: () => void
}

export function EmptyState({ onResetFilters }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
      <div className="mb-3 rounded-full bg-muted p-3">
        <Search className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="mb-1 text-lg font-medium">No strategies found</h3>
      <p className="mb-4 text-sm text-muted-foreground">Try adjusting your search or filter criteria</p>
      <Button variant="outline" onClick={onResetFilters}>
        Reset Filters
      </Button>
    </div>
  )
}
