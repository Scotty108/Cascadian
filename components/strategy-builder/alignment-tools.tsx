/**
 * Alignment Tools Component
 *
 * Task Group 18: Manual Layout Tools and Persistence
 * Subtask 18.5: Alignment tools for selected nodes
 *
 * Provides buttons to align and distribute selected nodes. Supports:
 * - Align left, right, top, bottom
 * - Distribute horizontally and vertically
 *
 * Operates on ReactFlow multi-selected nodes.
 */

"use client"

import { Button } from '@/components/ui/button'
import {
  AlignLeft,
  AlignRight,
  AlignStartVertical,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
} from 'lucide-react'
import type { Node } from '@xyflow/react'

export interface AlignmentToolsProps {
  selectedNodes: Node[]
  onNodesChange: (nodes: Node[]) => void
}

export function AlignmentTools({ selectedNodes, onNodesChange }: AlignmentToolsProps) {
  const disabled = selectedNodes.length < 2

  /**
   * Align all selected nodes to the leftmost x position
   */
  const alignLeft = () => {
    if (disabled) return

    const minX = Math.min(...selectedNodes.map((n) => n.position.x))
    const updated = selectedNodes.map((n) => ({
      ...n,
      position: { ...n.position, x: minX },
    }))
    onNodesChange(updated)
  }

  /**
   * Align all selected nodes to the rightmost x position
   */
  const alignRight = () => {
    if (disabled) return

    const maxX = Math.max(
      ...selectedNodes.map((n) => n.position.x + (n.width || 200))
    )
    const updated = selectedNodes.map((n) => ({
      ...n,
      position: { ...n.position, x: maxX - (n.width || 200) },
    }))
    onNodesChange(updated)
  }

  /**
   * Align all selected nodes to the topmost y position
   */
  const alignTop = () => {
    if (disabled) return

    const minY = Math.min(...selectedNodes.map((n) => n.position.y))
    const updated = selectedNodes.map((n) => ({
      ...n,
      position: { ...n.position, y: minY },
    }))
    onNodesChange(updated)
  }

  /**
   * Align all selected nodes to the bottommost y position
   */
  const alignBottom = () => {
    if (disabled) return

    const maxY = Math.max(
      ...selectedNodes.map((n) => n.position.y + (n.height || 100))
    )
    const updated = selectedNodes.map((n) => ({
      ...n,
      position: { ...n.position, y: maxY - (n.height || 100) },
    }))
    onNodesChange(updated)
  }

  /**
   * Distribute selected nodes evenly along the horizontal axis
   */
  const distributeHorizontally = () => {
    if (disabled) return

    // Sort nodes by x position
    const sorted = [...selectedNodes].sort((a, b) => a.position.x - b.position.x)

    // Calculate total width and spacing
    const leftmost = sorted[0].position.x
    const rightmost =
      sorted[sorted.length - 1].position.x + (sorted[sorted.length - 1].width || 200)
    const totalWidth = rightmost - leftmost
    const nodeWidths = sorted.reduce((sum, n) => sum + (n.width || 200), 0)
    const spacing = (totalWidth - nodeWidths) / (sorted.length - 1)

    // Distribute nodes
    let currentX = leftmost
    const updated = sorted.map((n) => {
      const node = {
        ...n,
        position: { ...n.position, x: currentX },
      }
      currentX += (n.width || 200) + spacing
      return node
    })

    onNodesChange(updated)
  }

  /**
   * Distribute selected nodes evenly along the vertical axis
   */
  const distributeVertically = () => {
    if (disabled) return

    // Sort nodes by y position
    const sorted = [...selectedNodes].sort((a, b) => a.position.y - b.position.y)

    // Calculate total height and spacing
    const topmost = sorted[0].position.y
    const bottommost =
      sorted[sorted.length - 1].position.y + (sorted[sorted.length - 1].height || 100)
    const totalHeight = bottommost - topmost
    const nodeHeights = sorted.reduce((sum, n) => sum + (n.height || 100), 0)
    const spacing = (totalHeight - nodeHeights) / (sorted.length - 1)

    // Distribute nodes
    let currentY = topmost
    const updated = sorted.map((n) => {
      const node = {
        ...n,
        position: { ...n.position, y: currentY },
      }
      currentY += (n.height || 100) + spacing
      return node
    })

    onNodesChange(updated)
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={alignLeft}
        title="Align left"
        className="h-8 w-8 p-0"
      >
        <AlignLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={alignRight}
        title="Align right"
        className="h-8 w-8 p-0"
      >
        <AlignRight className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={alignTop}
        title="Align top"
        className="h-8 w-8 p-0"
      >
        <AlignStartVertical className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={alignBottom}
        title="Align bottom"
        className="h-8 w-8 p-0"
      >
        <AlignEndVertical className="h-4 w-4" />
      </Button>
      <div className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={distributeHorizontally}
        title="Distribute horizontally"
        className="h-8 w-8 p-0"
      >
        <AlignHorizontalDistributeCenter className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={distributeVertically}
        title="Distribute vertically"
        className="h-8 w-8 p-0"
      >
        <AlignVerticalDistributeCenter className="h-4 w-4" />
      </Button>
    </div>
  )
}
