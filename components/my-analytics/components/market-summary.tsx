import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { marketSummaryData } from "../data"

export function MarketSummary() {
  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <CardTitle>Top Market Summary</CardTitle>
        <CardDescription>Top performing markets in your portfolio</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="font-medium">Market</div>
            <div className="font-medium">Price</div>
            <div className="font-medium">Change</div>
          </div>
          {marketSummaryData.map((item, index) => (
            <div key={index} className="grid grid-cols-3 gap-4">
              <div className="font-medium">{item.market}</div>
              <div>{item.price}</div>
              <div className={item.isPositive ? "text-green-500" : "text-red-500"}>{item.change}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
