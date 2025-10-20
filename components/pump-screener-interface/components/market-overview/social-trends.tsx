"use client"

import { MessageCircle, Twitter, Send } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { socialTrendingData, telegramActivityData } from "../../data"

export function SocialTrends() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5" />
          Social Trends
        </CardTitle>
        <CardDescription>Social media activity and sentiment analysis</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Twitter Trending */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Twitter className="h-4 w-4" />
            <span className="font-medium">Twitter Mentions (24h)</span>
          </div>
          <div className="space-y-3">
            {socialTrendingData.map((item, index) => (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{item.coin}</span>
                  <span className="text-sm text-muted-foreground">{item.mentions.toLocaleString()}</span>
                </div>
                <Progress value={item.percentage} className="h-1" />
              </div>
            ))}
          </div>
        </div>

        {/* Telegram Activity */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            <span className="font-medium">Telegram Activity</span>
          </div>
          <div className="space-y-2">
            {telegramActivityData.map((item, index) => (
              <div key={index} className="flex items-center justify-between">
                <span className="text-sm">{item.coin}</span>
                <Badge
                  variant="outline"
                  className={
                    item.activity === "Very High"
                      ? "bg-red-500/20 text-red-600 border-red-500/30"
                      : item.activity === "High"
                        ? "bg-orange-500/20 text-orange-600 border-orange-500/30"
                        : item.activity === "Medium"
                          ? "bg-yellow-500/20 text-yellow-600 border-yellow-500/30"
                          : "bg-green-500/20 text-green-600 border-green-500/30"
                  }
                >
                  {item.activity}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
