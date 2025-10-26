/**
 * Grid Snap Toggle Component
 *
 * Task Group 18: Manual Layout Tools and Persistence
 * Subtask 18.6: Grid snap toggle for manual positioning
 *
 * Provides a checkbox toggle to enable/disable grid snapping during node dragging.
 * When enabled, nodes snap to a 20px grid for precise alignment.
 */

"use client"

import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

export interface GridSnapToggleProps {
  snapToGrid: boolean
  onChange: (snap: boolean) => void
}

export function GridSnapToggle({ snapToGrid, onChange }: GridSnapToggleProps) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id="grid-snap"
        checked={snapToGrid}
        onCheckedChange={(checked) => onChange(checked === true)}
      />
      <Label htmlFor="grid-snap" className="text-sm cursor-pointer">
        Snap to grid
      </Label>
    </div>
  )
}
