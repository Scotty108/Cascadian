"use client"

import { CategoryCard } from "./category-card"
import { CATEGORIES } from "../constants"

interface CategoryFiltersProps {
  selectedCategory: string
  onCategoryChange: (categoryId: string) => void
}

export function CategoryFilters({ selectedCategory, onCategoryChange }: CategoryFiltersProps) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
      {CATEGORIES.map((category) => (
        <CategoryCard
          key={category.id}
          category={category}
          isSelected={selectedCategory === category.id}
          onClick={() => onCategoryChange(category.id)}
        />
      ))}
    </div>
  )
}
