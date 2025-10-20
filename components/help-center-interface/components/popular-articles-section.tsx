"use client"

import { FileText, Info, ArrowRight } from "lucide-react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArticleItem } from "./article-item"
import type { Article } from "../types"

interface PopularArticlesSectionProps {
  articles: Article[]
  onArticleClick?: (article: Article) => void
  onViewAllClick?: () => void
}

export function PopularArticlesSection({ articles, onArticleClick, onViewAllClick }: PopularArticlesSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <FileText className="mr-2 h-5 w-5" />
          Popular Articles
        </CardTitle>
        <CardDescription>Browse our most helpful resources and guides</CardDescription>
      </CardHeader>
      <CardContent>
        {articles.length > 0 ? (
          <div className="space-y-4">
            {articles.map((article) => (
              <ArticleItem key={article.id} article={article} onClick={() => onArticleClick?.(article)} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Info className="mb-2 h-10 w-10 text-muted-foreground" />
            <h3 className="text-lg font-medium">No articles found</h3>
            <p className="text-muted-foreground">Try adjusting your search or category filter</p>
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button variant="outline" className="w-full" onClick={onViewAllClick}>
          View All Articles
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </CardFooter>
    </Card>
  )
}
