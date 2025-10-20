"use client"

import { ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { Article } from "../types"
import { formatViews, getCategoryName } from "../utils"
import { CATEGORIES } from "../constants"

interface ArticleItemProps {
  article: Article
  onClick?: () => void
}

export function ArticleItem({ article, onClick }: ArticleItemProps) {
  return (
    <div
      className="flex items-start justify-between rounded-lg border p-4 transition-colors hover:bg-muted/50 cursor-pointer"
      onClick={onClick}
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-medium">{article.title}</h3>
          <Badge variant="outline" className="ml-2">
            {getCategoryName(article.category, CATEGORIES)}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {formatViews(article.views)} views • Updated {article.updated}
        </p>
      </div>
      <Button variant="ghost" size="icon">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
