"use client"

import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FileText } from "lucide-react"
import type { ActivityItem as ActivityItemType } from "../../types"
import { BotActivityItem } from "./activity-item"

interface RecentActivityProps {
  activities: ActivityItemType[]
}

export function RecentActivity({ activities }: RecentActivityProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[300px]">
          <div className="space-y-4">
            {activities.map((activity) => (
              <BotActivityItem key={activity.id} item={activity} />
            ))}
          </div>
        </ScrollArea>
      </CardContent>
      <CardFooter className="border-t p-4">
        <Button variant="outline" size="sm" className="w-full">
          <FileText className="mr-2 h-4 w-4" />
          View Activity Log
        </Button>
      </CardFooter>
    </Card>
  )
}
