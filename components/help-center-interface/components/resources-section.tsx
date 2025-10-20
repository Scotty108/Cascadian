"use client"

import { BookOpen } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ResourceLinkItem } from "./resource-link-item"
import { RESOURCE_LINKS } from "../data"

interface ResourcesSectionProps {
  onResourceClick?: (resourceTitle: string) => void
}

export function ResourcesSection({ onResourceClick }: ResourcesSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <BookOpen className="mr-2 h-5 w-5" />
          Resources
        </CardTitle>
        <CardDescription>Additional materials and documentation</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {RESOURCE_LINKS.map((resource) => (
            <ResourceLinkItem
              key={resource.title}
              resource={resource}
              onClick={() => onResourceClick?.(resource.title)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
