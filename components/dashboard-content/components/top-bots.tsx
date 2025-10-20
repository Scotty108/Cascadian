"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import type { TopBot } from "../types"

interface TopBotsProps {
  bots: TopBot[]
}

export function TopBots({ bots }: TopBotsProps) {
  return (
    <Card className="lg:col-span-4">
      <CardHeader>
        <CardTitle>Top Performing Bots</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            <div className="col-span-2 font-medium">Bot Name</div>
            <div className="font-medium">Profit</div>
            <div className="font-medium">Win Rate</div>
          </div>

          {bots.map((bot, index) => (
            <div key={index} className="grid grid-cols-4 gap-4">
              <div className="col-span-2">
                <div className="font-medium">{bot.name}</div>
                <div className="text-xs text-muted-foreground">{bot.type}</div>
              </div>
              <div className="text-green-500">{bot.profit}</div>
              <div>{bot.winRate}</div>
            </div>
          ))}
        </div>
      </CardContent>
      <CardFooter>
        <Button href="/control-panel/overview" variant="outline" className="w-full" >

          View All Bots
        </Button>
      </CardFooter>
    </Card>
  )
}
