"use client"

import { Zap, TrendingUp, LineChart, BarChart3, Plus } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

const templates = [
  {
    icon: Zap,
    title: "Small Cap Gems",
    assets: 15,
    description: "Low market cap tokens with high potential",
  },
  {
    icon: TrendingUp,
    title: "Meme Season",
    assets: 8,
    description: "Popular meme coins and community tokens",
  },
  {
    icon: LineChart,
    title: "DeFi Movers",
    assets: 12,
    description: "DeFi protocols and governance tokens",
  },
  {
    icon: BarChart3,
    title: "AI Tokens",
    assets: 10,
    description: "Artificial intelligence and ML tokens",
  },
]

export function WatchlistTemplates() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Watchlist Templates</CardTitle>
        <CardDescription>Quick start with pre-configured watchlists</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {templates.map((template, index) => {
          const IconComponent = template.icon
          return (
            <div key={index} className="flex items-center justify-between p-3 border rounded-lg gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <IconComponent className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="font-medium">{template.title}</h4>
                  <p className="text-sm text-muted-foreground">{template.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{template.assets} assets</Badge>
                <Button size="sm">
                  <Plus className="h-3 w-3 mr-1" />
                  Add
                </Button>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
