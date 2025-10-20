"use client"

import { Filter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CATEGORIES, TYPES, COMPLEXITY_LEVELS } from "../constants"

interface FiltersSectionProps {
  showFilters: boolean
  onToggleFilters: () => void
  selectedCategory: string
  selectedType: string
  selectedComplexity: string
  onCategoryChange: (value: string) => void
  onTypeChange: (value: string) => void
  onComplexityChange: (value: string) => void
  hasActiveFilters: boolean
}

export function FiltersSection({
  showFilters,
  onToggleFilters,
  selectedCategory,
  selectedType,
  selectedComplexity,
  onCategoryChange,
  onTypeChange,
  onComplexityChange,
  hasActiveFilters,
}: FiltersSectionProps) {
  return (
    <>
      <Button variant="outline" size="sm" className="ml-auto h-9 gap-1 sm:ml-0" onClick={onToggleFilters}>
        <Filter className="h-4 w-4" />
        Filters
        <Badge variant="secondary" className="ml-1 rounded-sm px-1">
          {hasActiveFilters ? "ON" : "OFF"}
        </Badge>
      </Button>

      {showFilters && (
        <div className="grid grid-cols-1 gap-4 rounded-lg border p-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="category-filter" className="text-sm">
              Category
            </Label>
            <Select value={selectedCategory} onValueChange={onCategoryChange}>
              <SelectTrigger id="category-filter" className="mt-1">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((category) => (
                  <SelectItem key={category.value} value={category.value}>
                    {category.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="type-filter" className="text-sm">
              Type
            </Label>
            <Select value={selectedType} onValueChange={onTypeChange}>
              <SelectTrigger id="type-filter" className="mt-1">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="complexity-filter" className="text-sm">
              Complexity
            </Label>
            <Select value={selectedComplexity} onValueChange={onComplexityChange}>
              <SelectTrigger id="complexity-filter" className="mt-1">
                <SelectValue placeholder="Select complexity" />
              </SelectTrigger>
              <SelectContent>
                {COMPLEXITY_LEVELS.map((level) => (
                  <SelectItem key={level.value} value={level.value}>
                    {level.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </>
  )
}
