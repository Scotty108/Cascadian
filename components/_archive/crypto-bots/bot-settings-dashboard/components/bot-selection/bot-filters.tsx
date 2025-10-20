"use client"

import { Button } from "@/components/ui/button"
import { CardFooter } from "@/components/ui/card"
import { Filter, Sliders } from "lucide-react"

interface BotFiltersProps {
  onFilter: () => void
  onSort: () => void
}

export function BotFilters({ onFilter, onSort }: BotFiltersProps) {
  return (
    <CardFooter className="flex justify-between border-t p-4">
      <Button variant="outline" size="sm" onClick={onFilter}>
        <Filter className="mr-2 h-4 w-4" />
        Filter
      </Button>
      <Button variant="outline" size="sm" onClick={onSort}>
        <Sliders className="mr-2 h-4 w-4" />
        Sort
      </Button>
    </CardFooter>
  )
}
