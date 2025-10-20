import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { KpiCard } from "../types"

interface KpiCardsProps {
  cards: KpiCard[]
}

export function KpiCards({ cards }: KpiCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card, index) => (
        <Card key={index}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
            {card.icon}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.value}</div>
            <p
              className={`text-xs ${card.changeType === "positive" ? "text-green-500" : card.changeType === "negative" ? "text-red-500" : "text-muted-foreground"}`}
            >
              {card.change}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
