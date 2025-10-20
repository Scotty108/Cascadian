import { ArrowDown, ArrowUp } from "lucide-react"
import { TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { SortConfig, ExecutionLog } from "../../types"

interface LogsTableHeaderProps {
  sortConfig: SortConfig
  onSort: (key: keyof ExecutionLog) => void
}

export const LogsTableHeader = ({ sortConfig, onSort }: LogsTableHeaderProps) => {
  const renderSortIcon = (key: keyof ExecutionLog) => {
    if (sortConfig.key !== key) return null

    return sortConfig.direction === "asc" ? (
      <ArrowUp className="ml-1 h-4 w-4" />
    ) : (
      <ArrowDown className="ml-1 h-4 w-4" />
    )
  }

  const getSortableHeaderProps = (key: keyof ExecutionLog) => ({
    onClick: () => onSort(key),
    className: "cursor-pointer select-none",
  })

  return (
    <TableHeader>
      <TableRow>
        <TableHead {...getSortableHeaderProps("timestamp")} className="w-[180px]">
          <div className="flex items-center">
            Timestamp
            {renderSortIcon("timestamp")}
          </div>
        </TableHead>
        <TableHead className="w-[100px]">Level</TableHead>
        <TableHead {...getSortableHeaderProps("botName")} className="w-[150px]">
          <div className="flex items-center">
            Bot
            {renderSortIcon("botName")}
          </div>
        </TableHead>
        <TableHead {...getSortableHeaderProps("action")} className="w-[150px]">
          <div className="flex items-center">
            Action
            {renderSortIcon("action")}
          </div>
        </TableHead>
        <TableHead className="w-[100px]">Status</TableHead>
        <TableHead className="min-w-[300px]">Message</TableHead>
        <TableHead className="w-[100px] text-right">Duration</TableHead>
        <TableHead className="w-[80px]"></TableHead>
      </TableRow>
    </TableHeader>
  )
}
