"use client"

import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { Category } from "../types"

interface CategoryCardProps {
  category: Category
  isSelected: boolean
  onClick: () => void
}

export function CategoryCard({ category, isSelected, onClick }: CategoryCardProps) {
  const Icon = category.icon

  return (
    <Card
      className={cn("cursor-pointer transition-colors hover:bg-muted/50", isSelected && "border-primary bg-primary/5")}
      onClick={onClick}
    >
      <CardContent className="flex flex-col items-center justify-center p-4 text-center">
        <Icon className="mb-2 h-8 w-8 text-primary" />
        <span className="text-sm font-medium">{category.name}</span>
      </CardContent>
    </Card>
  )
}
