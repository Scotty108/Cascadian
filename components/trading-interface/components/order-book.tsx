import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ArrowDown, ArrowUp } from "lucide-react"
import { mockOrderBookAsks, mockOrderBookBids } from "../data"

export function OrderBook() {
  const currentPrice = 42831.07
  const priceChange = -0.12

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xl font-bold">Order Book</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {/* Asks (Sell Orders) */}
        <div className="border-b border-border">
          <ScrollArea className="h-[200px]">
            <div className="grid grid-cols-3 gap-2 p-2 text-sm">
              <div className="font-medium text-muted-foreground">Price (USDT)</div>
              <div className="font-medium text-muted-foreground">Amount (BTC)</div>
              <div className="font-medium text-muted-foreground">Total</div>

              {mockOrderBookAsks.map((order, i) => (
                <div key={`ask-${i}`} className="col-span-3 grid grid-cols-3 gap-2 hover:bg-muted/50">
                  <div className="font-medium text-red-500">
                    {order.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                  <div>{order.amount.toLocaleString(undefined, { minimumFractionDigits: 4 })}</div>
                  <div>{order.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Current Price */}
        <div className="border-b border-border p-2">
          <div className="flex items-center justify-between">
            <div className="text-lg font-bold">${currentPrice.toLocaleString()}</div>
            <div className={`flex items-center gap-1 text-sm ${priceChange >= 0 ? "text-green-500" : "text-red-500"}`}>
              {priceChange >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
              <span>{Math.abs(priceChange)}%</span>
            </div>
          </div>
        </div>

        {/* Bids (Buy Orders) */}
        <ScrollArea className="h-[200px]">
          <div className="grid grid-cols-3 gap-2 p-2 text-sm">
            {mockOrderBookBids.map((order, i) => (
              <div key={`bid-${i}`} className="col-span-3 grid grid-cols-3 gap-2 hover:bg-muted/50">
                <div className="font-medium text-green-500">
                  {order.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                <div>{order.amount.toLocaleString(undefined, { minimumFractionDigits: 4 })}</div>
                <div>{order.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
