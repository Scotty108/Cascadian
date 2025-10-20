"use client"

import { useState } from "react"
import { History, ExternalLink, Clock, CheckCircle, XCircle } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatCurrency, formatTimeAgo } from "../../utils"
import type { TransactionState, Transaction } from "../../types"

interface TransactionHistoryProps {
  transactionState: TransactionState
}

export function TransactionHistory({ transactionState }: TransactionHistoryProps) {
  const [filter, setFilter] = useState<"all" | "pending" | "completed" | "failed">("all")

  const allTransactions = [...transactionState.pending, ...transactionState.completed, ...transactionState.failed].sort(
    (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
  )

  const filteredTransactions = filter === "all" ? allTransactions : allTransactions.filter((tx) => tx.status === filter)

  const getStatusIcon = (status: Transaction["status"]) => {
    switch (status) {
      case "pending":
        return <Clock className="h-4 w-4 text-yellow-500" />
      case "completed":
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />
    }
  }

  const getStatusBadge = (status: Transaction["status"]) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="outline" className="text-yellow-600 border-yellow-600">
            Pending
          </Badge>
        )
      case "completed":
        return (
          <Badge variant="outline" className="text-green-600 border-green-600">
            Completed
          </Badge>
        )
      case "failed":
        return (
          <Badge variant="outline" className="text-red-600 border-red-600">
            Failed
          </Badge>
        )
    }
  }

  const getTypeLabel = (type: Transaction["type"]) => {
    switch (type) {
      case "deposit":
        return "Deposit"
      case "withdraw":
        return "Withdraw"
      case "harvest":
        return "Harvest"
      case "compound":
        return "Compound"
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex gap-4 flex-wrap items-center justify-between ">
          <div>
            <CardTitle className="flex items-center">
              <History className="mr-2 h-5 w-5" />
              Transaction History
            </CardTitle>
            <CardDescription>Track all your yield farming transactions</CardDescription>
          </div>
          <Select value={filter} onValueChange={(value: any) => setFilter(value)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {filteredTransactions.length === 0 ? (
          <div className="text-center py-8">
            <History className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {filter === "all" ? "No transactions yet" : `No ${filter} transactions`}
            </p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Hash</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTransactions.map((transaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        {getStatusIcon(transaction.status)}
                        <span className="font-medium">{getTypeLabel(transaction.type)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{formatCurrency(transaction.amount)}</TableCell>
                    <TableCell>{getStatusBadge(transaction.status)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatTimeAgo(transaction.timestamp)}</TableCell>
                    <TableCell>
                      {transaction.hash ? (
                        <Button variant="ghost" size="sm" className="h-8 px-2">
                          <ExternalLink className="h-3 w-3 mr-1" />
                          <span className="text-xs">
                            {transaction.hash.slice(0, 6)}...{transaction.hash.slice(-4)}
                          </span>
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
