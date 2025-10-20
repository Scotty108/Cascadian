"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet } from "lucide-react";
import type { Transaction } from "../types";

interface TransactionHistoryProps {
  transactions: Transaction[];
}

export function TransactionHistory({ transactions }: TransactionHistoryProps) {
  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <CardTitle>Transaction History</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {transactions.map((transaction, index) => (
            <div key={index} className="flex items-center gap-4">
              <div className="rounded-full bg-blue-500/20 p-2">
                <Wallet className="h-4 w-4 text-blue-500" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <div className="font-medium">
                    {transaction.type === "bought" ? "Bought" : "Sold"} {transaction.asset}
                  </div>
                  <div className="font-medium">{transaction.amount}</div>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <div>{transaction.date}</div>
                  <div>{transaction.value}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
      <CardFooter>
        <Button variant="outline" className="w-full" href="/trading">
          View All Transactions
        </Button>
      </CardFooter>
    </Card>
  );
}
