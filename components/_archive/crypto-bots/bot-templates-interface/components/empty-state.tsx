"use client"

import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"

interface EmptyStateProps {
  onResetFilters: () => void
}

export function EmptyState({ onResetFilters }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
        <AlertTriangle className="h-10 w-10 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-lg font-semibold">No templates found</h3>
      <p className="mt-2 text-center text-muted-foreground">
        Try adjusting your search or filter criteria to find what you&apos;re looking for.
      </p>
      <Button variant="outline" className="mt-4" onClick={onResetFilters}>
        Reset Filters
      </Button>
    </div>
  )
}
