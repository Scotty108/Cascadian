import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ExternalLink } from "lucide-react"
import { OrderForm } from "./order-form"
import type { OrderFormData } from "../types"

interface TradingTabsProps {
  buyOrder: OrderFormData
  sellOrder: OrderFormData
  onBuyOrderChange: (field: keyof OrderFormData, value: string) => void
  onSellOrderChange: (field: keyof OrderFormData, value: string) => void
  onBuyPercentageClick: (percentage: number) => void
  onSellPercentageClick: (percentage: number) => void
  onExecuteBuy: () => void
  onExecuteSell: () => void
}

export function TradingTabs({
  buyOrder,
  sellOrder,
  onBuyOrderChange,
  onSellOrderChange,
  onBuyPercentageClick,
  onSellPercentageClick,
  onExecuteBuy,
  onExecuteSell,
}: TradingTabsProps) {
  return (
    <Tabs defaultValue="buy-sell">
     <div className="overflow-x-scroll">
     <TabsList className="w-full justify-start min-w-[350px]">
        <TabsTrigger value="buy-sell" className="flex-1 sm:flex-none">
          Buy/Sell
        </TabsTrigger>
        <TabsTrigger value="smart-trade" className="flex-1 sm:flex-none">
          Smart Trade
        </TabsTrigger>
        <TabsTrigger value="smart-cover" className="flex-1 sm:flex-none">
          Smart Cover
        </TabsTrigger>
      </TabsList>
     </div>

      <TabsContent value="buy-sell" className="mt-4">
        <div className="md:grid max-md:space-y-4 gap-4 md:grid-cols-2">
          <OrderForm
            type="buy"
            order={buyOrder}
            availableBalance="$12,500.25"
            onOrderChange={onBuyOrderChange}
            onPercentageClick={onBuyPercentageClick}
            onExecute={onExecuteBuy}
          />

          <OrderForm
            type="sell"
            order={sellOrder}
            availableBalance="0.42000000 BTC"
            onOrderChange={onSellOrderChange}
            onPercentageClick={onSellPercentageClick}
            onExecute={onExecuteSell}
          />
        </div>
      </TabsContent>

      <TabsContent value="smart-trade" className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Smart Trade</CardTitle>
            <CardDescription>Advanced trading features with take profit and stop loss</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="p-6 text-muted-foreground">
              <h3 className="text-lg font-semibold mb-2">Key Features:</h3>
              <ul className="list-disc list-inside space-y-1">
                <li>Automated Take Profit & Stop Loss orders</li>
                <li>Trailing Stop for dynamic profit protection</li>
                <li>One-Cancels-the-Other (OCO) orders</li>
                <li>Customizable order execution strategies</li>
              </ul>
              <p className="mt-4">Unlock advanced trading capabilities to maximize your gains and minimize risks.</p>
              <Button variant="link" className="h-auto p-0 mt-2">
                Learn More <ExternalLink className="ml-1 h-3 w-3" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="smart-cover" className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Smart Cover</CardTitle>
            <CardDescription>Protect your positions with automated risk management</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="p-6 text-muted-foreground">
              <h3 className="text-lg font-semibold mb-2">Key Features:</h3>
              <ul className="list-disc list-inside space-y-1">
                <li>Automated risk management for open positions</li>
                <li>Dynamic stop-loss adjustments based on market movement</li>
                <li>Partial close options to secure profits</li>
                <li>Integration with various defi protocols</li>
              </ul>
              <p className="mt-4">Safeguard your investments with intelligent, automated risk management strategies.</p>
              <Button variant="link" className="h-auto p-0 mt-2">
                Learn More <ExternalLink className="ml-1 h-3 w-3" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}
