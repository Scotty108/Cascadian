"use client"

import { Button } from "@/components/ui/button"
import type { StrategyCategory } from "../types"

interface CategoryFiltersProps {
  selectedCategory: StrategyCategory
  onCategoryChange: (category: StrategyCategory) => void
}

const categories: StrategyCategory[] = [
  "All",
  "AI-Powered",
  "Trend Following",
  "Mean Reversion",
  "Breakout",
  "Scalping",
  "Grid Trading",
  "DCA",
  "Arbitrage",
]

export function CategoryFilters({ selectedCategory, onCategoryChange }: CategoryFiltersProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {categories.map((category) => (
        <Button
          key={category}
          variant={selectedCategory === category ? "secondary" : "outline"}
          size="sm"
          className="rounded-full"
          onClick={() => onCategoryChange(category)}
        >
          {category}
        </Button>
      ))}
    </div>
  )
}
