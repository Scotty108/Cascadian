"use client"

import { useState } from "react"
import { format } from "date-fns"
import { CalendarIcon, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface DateRangePickerProps {
  from: Date | null
  to: Date | null
  onDateRangeChange: (from: Date | null, to: Date | null) => void
  className?: string
}

export const DateRangePicker = ({ from, to, onDateRangeChange, className = "" }: DateRangePickerProps) => {
  const [isOpen, setIsOpen] = useState(false)

  const handleSelect = (date: Date | undefined) => {
    if (!date) return

    if (!from || (from && to)) {
      // If no from date or both dates are set, start a new range
      onDateRangeChange(date, null)
    } else {
      // If from date is set but no to date, complete the range
      const newTo = date < from ? from : date
      const newFrom = date < from ? date : from
      onDateRangeChange(newFrom, newTo)
      setIsOpen(false)
    }
  }

  const handleClear = () => {
    onDateRangeChange(null, null)
    setIsOpen(false)
  }

  let buttonText = "Select date range"
  if (from && to) {
    buttonText = `${format(from, "MMM d")} - ${format(to, "MMM d, yyyy")}`
  } else if (from) {
    buttonText = `${format(from, "MMM d, yyyy")} - Select end date`
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("justify-start text-left font-normal", className, {
            "text-muted-foreground": !from,
          })}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {buttonText}
          {(from || to) && (
            <X
              className="ml-auto h-4 w-4 opacity-50 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation()
                handleClear()
              }}
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={{
            from: from || undefined,
            to: to || undefined,
          }}
          onSelect={(range) => {
            if (!range) return
            onDateRangeChange(range.from || null, range.to || null)
            if (range.from && range.to) {
              setIsOpen(false)
            }
          }}
          initialFocus
        />
        <div className="flex items-center justify-between p-3 border-t">
          <Button variant="ghost" size="sm" onClick={handleClear}>
            Clear
          </Button>
          <Button size="sm" onClick={() => setIsOpen(false)}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
