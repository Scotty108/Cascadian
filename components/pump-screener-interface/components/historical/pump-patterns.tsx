"use client"

import { Volume2, TrendingUp, Zap, MessageCircle, Info } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const patterns = [
  {
    icon: Volume2,
    title: "Volume Spike Pattern",
    description: "Sudden increase in volume followed by price movement",
    details: "Volume increases 300-500% before significant price movement. Often indicates early stage of pump.",
    frequency: "Common",
    reliability: "High",
  },
  {
    icon: TrendingUp,
    title: "Stair-Step Pattern",
    description: "Series of small pumps building momentum",
    details: "Multiple small price increases with consolidation periods between. Often seen in more sustainable pumps.",
    frequency: "Moderate",
    reliability: "Medium",
  },
  {
    icon: Zap,
    title: "Vertical Spike Pattern",
    description: "Explosive price movement in short timeframe",
    details: "Extremely rapid price increase (30%+ in minutes). Often indicates coordinated pump & dump schemes.",
    frequency: "Rare",
    reliability: "Very High",
  },
  {
    icon: MessageCircle,
    title: "Social Media Driven",
    description: "Pump triggered by social media activity",
    details: "Social mentions spike before price movement. Often triggered by influencers or community coordination.",
    frequency: "Common",
    reliability: "Medium",
  },
]

export function PumpPatterns() {
  const getFrequencyColor = (frequency: string) => {
    switch (frequency) {
      case "Common":
        return "bg-green-500/20 text-green-600 border-green-500/30"
      case "Moderate":
        return "bg-yellow-500/20 text-yellow-600 border-yellow-500/30"
      case "Rare":
        return "bg-red-500/20 text-red-600 border-red-500/30"
      default:
        return "bg-blue-500/20 text-blue-600 border-blue-500/30"
    }
  }

  const getReliabilityColor = (reliability: string) => {
    switch (reliability) {
      case "Very High":
        return "bg-green-500/20 text-green-600 border-green-500/30"
      case "High":
        return "bg-blue-500/20 text-blue-600 border-blue-500/30"
      case "Medium":
        return "bg-yellow-500/20 text-yellow-600 border-yellow-500/30"
      default:
        return "bg-gray-500/20 text-gray-600 border-gray-500/30"
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Info className="h-5 w-5" />
          Pump Patterns
        </CardTitle>
        <CardDescription>Common patterns observed in historical pump events</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {patterns.map((pattern, index) => {
          const IconComponent = pattern.icon
          return (
            <div key={index} className="p-3 border rounded-lg space-y-3">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <IconComponent className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <h4 className="font-medium">{pattern.title}</h4>
                  <p className="text-sm text-muted-foreground">{pattern.description}</p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">{pattern.details}</p>

              <div className="flex items-center gap-2">
                <Badge variant="outline" className={getFrequencyColor(pattern.frequency)}>
                  {pattern.frequency}
                </Badge>
                <Badge variant="outline" className={getReliabilityColor(pattern.reliability)}>
                  {pattern.reliability} Reliability
                </Badge>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
