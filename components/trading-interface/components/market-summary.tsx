import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface MarketSummaryProps {
  pair: string
}

export function MarketSummary({ pair }: MarketSummaryProps) {
  // Mock data - in real app, this would come from props or API
  const marketData = {
    change24h: 2.34,
    high24h: 43250.5,
    low24h: 41780.25,
    volume24h: 1245789.32,
  }

  return (
    <Card className="col-span-1 lg:col-span-2">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Market Summary - {pair.toUpperCase()}</CardTitle>
      </CardHeader>
      <CardContent className="flex justify-between flex-wrap grid-cols-2 gap-4 md:grid-cols-4">
        <div>
          <div className="text-sm text-muted-foreground">24h Change</div>
          <div className={`text-lg font-medium ${marketData.change24h >= 0 ? "text-green-500" : "text-red-500"}`}>
            {marketData.change24h >= 0 ? "+" : ""}
            {marketData.change24h}%
          </div>
        </div>
        <div>
          <div className="text-sm text-muted-foreground">24h High</div>
          <div className="text-lg font-medium">${marketData.high24h.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-sm text-muted-foreground">24h Low</div>
          <div className="text-lg font-medium">${marketData.low24h.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-sm text-muted-foreground">24h Volume</div>
          <div className="text-lg font-medium">${marketData.volume24h.toLocaleString()}</div>
        </div>
      </CardContent>
    </Card>
  )
}
