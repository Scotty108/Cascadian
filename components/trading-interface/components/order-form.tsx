"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, Save, Share2 } from "lucide-react";
import type { OrderFormData } from "../types";

interface OrderFormProps {
  type: "buy" | "sell";
  order: OrderFormData;
  availableBalance: string;
  onOrderChange: (field: keyof OrderFormData, value: string) => void;
  onPercentageClick: (percentage: number) => void;
  onExecute: () => void;
}

export function OrderForm({ type, order, availableBalance, onOrderChange, onPercentageClick, onExecute }: OrderFormProps) {
  const isBuy = type === "buy";
  const percentages = [5, 10, 25, 50, 100];

  return (
    <Card className={cn(isBuy ? "border-green-500/20 bg-green-500/5" : "border-red-500/20 bg-red-500/5")}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap justify-between">
          <div className="flex items-center  gap-2">
            <div className={cn("rounded-full p-1.5", isBuy ? "bg-green-500/20" : "bg-red-500/20")}>
              {isBuy ? <ArrowDown className="h-4 w-4 text-green-500" /> : <ArrowUp className="h-4 w-4 text-red-500" />}
            </div>
            <span>{isBuy ? "Buy" : "Sell"} BTC</span>
          </div>
          <div className="text-sm text-muted-foreground">
            Available: <span className="font-medium">{availableBalance}</span>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor={`${type}-type`}>Type</Label>
            <div className="flex items-center gap-2">
              <div
                className={cn("cursor-pointer rounded-l-md border border-r-0 px-3 py-1 text-sm", order.type === "limit" ? "border-input bg-background" : "border-muted bg-muted text-muted-foreground")}
              >
                Limit
              </div>
              <div className={cn("cursor-pointer rounded-r-md border px-3 py-1 text-sm", order.type === "market" ? "border-input bg-background" : "border-muted bg-muted text-muted-foreground")}>
                Market
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${type}-amount`}>Amount (BTC)</Label>
            <Input id={`${type}-amount`} type="number" placeholder="0.00000000" value={order.amount} onChange={(e) => onOrderChange("amount", e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${type}-price`}>Price (USDT)</Label>
            <Input id={`${type}-price`} type="number" placeholder="0.00" value={order.price} onChange={(e) => onOrderChange("price", e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${type}-total`}>Total (USDT)</Label>
            <Input id={`${type}-total`} type="number" placeholder="0.00" value={order.total} onChange={(e) => onOrderChange("total", e.target.value)} />
          </div>

          <div className="flex justify-between flex-wrap gap-2 pt-2">
            {percentages.map((percentage) => (
              <Button key={percentage} variant="outline" size="sm" className="flex-1" onClick={() => onPercentageClick(percentage)}>
                {percentage}%
              </Button>
            ))}
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex justify-between">
        <Button variant="outline" size="sm" className="gap-1">
          {isBuy ? <Save className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
          {isBuy ? "Save" : "Share"}
        </Button>
        <Button className={isBuy ? "bg-green-600 hover:bg-green-700" : ""} variant={isBuy ? "default" : "destructive"} onClick={onExecute}>
          {isBuy ? "Buy" : "Sell"} BTC
        </Button>
      </CardFooter>
    </Card>
  );
}
