"use client"

import { Info } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { PLATFORM_STATUS } from "../constants"

interface PlatformStatusSectionProps {
  onStatusPageClick?: () => void
}

export function PlatformStatusSection({ onStatusPageClick }: PlatformStatusSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <Info className="mr-2 h-5 w-5" />
          Platform Status
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center">
              <div className="mr-2 h-3 w-3 rounded-full bg-green-500" />
              <span className="text-sm font-medium">{PLATFORM_STATUS.message}</span>
            </div>
            <Separator orientation="vertical" className="h-6" />
            <span className="text-sm text-muted-foreground">Last updated: {PLATFORM_STATUS.lastUpdated}</span>
          </div>
          <Button variant="outline" size="sm" onClick={onStatusPageClick}>
            View Status Page
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
