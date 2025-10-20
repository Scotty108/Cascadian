"use client"

import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ResourceLink } from "../types"

interface ResourceLinkItemProps {
  resource: ResourceLink
  onClick?: () => void
}

export function ResourceLinkItem({ resource, onClick }: ResourceLinkItemProps) {
  const Icon = resource.icon

  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="flex items-center">
        <Icon className="mr-3 h-5 w-5 text-primary" />
        <div>
          <span className="font-medium">{resource.title}</span>
          {resource.description && <p className="text-sm text-muted-foreground">{resource.description}</p>}
        </div>
      </div>
      <Button variant="ghost" size="icon" onClick={onClick}>
        <ExternalLink className="h-4 w-4" />
      </Button>
    </div>
  )
}
