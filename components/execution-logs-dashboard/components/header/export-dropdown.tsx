"use client"

import { Download, FileText, Code, Table } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { EXPORT_FORMATS } from "../../constants"

interface ExportDropdownProps {
  onExport: (format: "csv" | "json" | "xlsx") => void
}

export const ExportDropdown = ({ onExport }: ExportDropdownProps) => {
  const icons = {
    FileText,
    Code,
    Table,
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" />
          <span>Export</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {EXPORT_FORMATS.map((format) => {
          const Icon = icons[format.icon as keyof typeof icons]
          return (
            <DropdownMenuItem key={format.value} onClick={() => onExport(format.value as "csv" | "json" | "xlsx")}>
              <Icon className="h-4 w-4 mr-2" />
              <span>{format.label}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
