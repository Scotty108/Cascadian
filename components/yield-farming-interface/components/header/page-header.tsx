"use client"

import { RefreshCw, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"

export function PageHeader() {
  return (
    <div className="flex flex-col space-y-2 md:flex-row md:items-center md:justify-between md:space-y-0">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Yield Farming</h2>
        <p className="text-muted-foreground">Optimize your crypto assets with automated yield farming strategies</p>
      </div>
      <div className="flex items-center space-x-2">
        <Button variant="outline" size="sm">
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
        <Button variant="default" size="sm">
          <Plus className="mr-2 h-4 w-4" />
          New Position
        </Button>
      </div>
    </div>
  )
}
