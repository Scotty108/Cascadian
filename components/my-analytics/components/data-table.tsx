"use client"

import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import type { ColumnVisibility, SignalBot, SignalProvider, Trader } from "../types"

interface DataTableProps {
  data: SignalBot[] | Trader[] | SignalProvider[]
  visibleColumns: ColumnVisibility
  type: "signal-bots" | "traders" | "signal-providers"
  onEdit?: (item: SignalBot | Trader | SignalProvider) => void
  onFollow?: (item: Trader) => void
  onSubscribe?: (item: SignalProvider) => void
}

export function DataTable({ data, visibleColumns, type, onEdit, onFollow, onSubscribe }: DataTableProps) {
  const handleAction = (item: SignalBot | Trader | SignalProvider) => {
    console.log("Action clicked for:", item.name, "Type:", type)

    if (type === "signal-bots" && onEdit) {
      onEdit(item)
    } else if (type === "traders" && onFollow) {
      onFollow(item as Trader)
    } else if (type === "signal-providers" && onSubscribe) {
      onSubscribe(item as SignalProvider)
    }
  }

  if (data.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={Object.values(visibleColumns).filter(Boolean).length} className="h-24 text-center">
          No results found.
        </TableCell>
      </TableRow>
    )
  }

  return (
    <>
      {data.map((item) => (
        <TableRow key={item.id}>
          {visibleColumns.name && <TableCell className="font-medium">{item.name}</TableCell>}
          {visibleColumns.status && (
            <TableCell>
              <div
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  item.status === "Active"
                    ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
                    : item.status === "Paused"
                      ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300"
                      : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300"
                }`}
              >
                {item.status}
              </div>
            </TableCell>
          )}

          {/* Conditional rendering based on type */}
          {type === "traders" && "followers" in item && <TableCell className="text-right">{item.followers}</TableCell>}

          {type === "signal-providers" && "subscribers" in item && (
            <TableCell className="text-right">{item.subscribers}</TableCell>
          )}

          {visibleColumns.trades && type !== "signal-providers" && "trades" in item && (
            <TableCell className="text-right">{item.trades}</TableCell>
          )}

          {visibleColumns.winRate && <TableCell className="text-right">{item.winRate}%</TableCell>}

          {visibleColumns.profit && (
            <TableCell className={`text-right ${item.profit > 0 ? "text-green-500" : "text-red-500"}`}>
              {item.profit > 0 ? "+" : ""}
              {item.profit
                ? item.profit.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : 0}
            </TableCell>
          )}

          {visibleColumns.profitPercent && (
            <TableCell className={`text-right ${item.profitPercent > 0 ? "text-green-500" : "text-red-500"}`}>
              {item.profitPercent > 0 ? "+" : ""}
              {item.profitPercent ? item.profitPercent.toFixed(2) : 0}%
            </TableCell>
          )}

          {type === "signal-providers" && "signals" in item && (
            <TableCell className="text-right">{item.signals}</TableCell>
          )}

          {visibleColumns.volume && "volume" in item && (
            <TableCell className="text-right">${item.volume ? item.volume.toLocaleString() : 0}</TableCell>
          )}

          {visibleColumns.timeframe && <TableCell>{item.timeframe}</TableCell>}

          {visibleColumns.actions && (
            <TableCell className="text-right">
              <Button variant="ghost" size="sm" onClick={() => handleAction(item)} className="hover:bg-primary/10">
                {type === "traders" ? "Follow" : type === "signal-providers" ? "Subscribe" : "Edit"}
              </Button>
            </TableCell>
          )}
        </TableRow>
      ))}
    </>
  )
}
