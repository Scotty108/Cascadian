import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChevronUp } from "lucide-react"
import type { RecentTrade } from "../types"

interface RecentTradesProps {
  trades: RecentTrade[]
}

export function RecentTrades({ trades }: RecentTradesProps) {
  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <CardTitle>Recent Trades</CardTitle>
        <CardDescription>You made 265 trades this month.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-8">
          {trades.map((trade, index) => (
            <div key={index} className="flex items-center">
              <div className="flex items-center gap-2">
                <div
                  className={`rounded-full ${trade.changeType === "positive" ? "bg-green-500/20" : "bg-red-500/20"} p-1`}
                >
                  <ChevronUp
                    className={`h-3 w-3 ${trade.changeType === "positive" ? "text-green-500" : "text-red-500"}`}
                    style={{ transform: trade.changeType === "negative" ? "rotate(180deg)" : "none" }}
                  />
                </div>
                <div className="font-medium">{trade.pair}</div>
              </div>
              <div
                className={`ml-auto font-medium ${trade.changeType === "positive" ? "text-green-500" : "text-red-500"}`}
              >
                {trade.changeType === "positive" ? "+" : "-"}${trade.value}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
