"use client"

import { Button } from "@/components/ui/button"
import { Calendar, ChevronDown } from "lucide-react"

interface PageHeaderProps {
  dateRange: string
  onDateRangeChange: (range: string) => void
}

export function PageHeader({ dateRange, onDateRangeChange }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground">Monitor your trading performance and assets</p>
      </div>
     
    </div>
  )
}
