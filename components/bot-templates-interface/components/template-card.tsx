"use client"

import React from "react"
import Image from "next/image";
import { ChevronRight, Heart } from "lucide-react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { BotTemplate } from "../types"
import { formatPrice } from "../utils"
import { StarRating } from "./star-rating"
import { CreatorBadge } from "./creator-badge"
import { ComplexityBadge } from "./complexity-badge"
import { CategoryIcon } from "./category-icon"
import { PerformanceMetrics } from "./performance-metrics"
import { cn } from "@/lib/utils"

interface TemplateCardProps {
  template: BotTemplate
  onToggleFavorite: (id: string) => void
  onOpenDetails: (template: BotTemplate) => void
}

export const TemplateCard = React.memo(function TemplateCard({
  template,
  onToggleFavorite,
  onOpenDetails,
}: TemplateCardProps) {
  return (
    <Card className="flex h-full flex-col overflow-hidden transition-all hover:shadow-md">
      <div className="relative">
        <div className="aspect-video w-full overflow-hidden bg-muted">
          <Image
            src={template.image || "/placeholder.svg"}
            alt={template.name}
            className="h-full w-full object-cover transition-transform hover:scale-105"
            width={400}
            height={225}
          />
        </div>
        <div className="absolute right-2 top-2 flex gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleFavorite(template.id)
                  }}
                >
                  <Heart
                    className={cn(
                      "h-4 w-4",
                      template.isFavorite ? "fill-destructive text-destructive" : "text-muted-foreground",
                    )}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{template.isFavorite ? "Remove from favorites" : "Add to favorites"}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {template.isFeatured && <Badge className="absolute left-2 top-2 bg-primary">Featured</Badge>}
        {template.isNew && <Badge className="absolute left-2 top-2 bg-green-500">New</Badge>}
      </div>

      <CardHeader className="p-4 pb-0">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="line-clamp-1 text-lg">{template.name}</CardTitle>
            <div className="mt-1 flex items-center gap-2">
              <Badge variant="outline" className="flex items-center gap-1">
                <CategoryIcon category={template.category} />
                {template.category}
              </Badge>
              <ComplexityBadge complexity={template.complexity} />
            </div>
          </div>
          <div className="text-right">
            <div className="font-semibold">
              {template.price === "Free" ? (
                <span className="text-green-500">Free</span>
              ) : (
                <span>{formatPrice(template.price)}</span>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-4 pt-3">
        <CardDescription className="line-clamp-2 min-h-[40px]">{template.description}</CardDescription>

        <div className="mt-3">
          <PerformanceMetrics performance={template.performance} />
        </div>

        <div className="mt-3">
          <CreatorBadge creator={template.creator} />
        </div>
      </CardContent>

      <CardFooter className="flex items-center justify-between p-4 pt-0">
        <div className="flex items-center">
          <StarRating rating={template.rating} />
          <span className="ml-1 text-xs text-muted-foreground">({template.reviews})</span>
        </div>
        <Button variant="default" size="sm" className="gap-1" onClick={() => onOpenDetails(template)}>
          Details <ChevronRight className="h-3 w-3" />
        </Button>
      </CardFooter>
    </Card>
  )
})
