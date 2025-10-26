/**
 * Layout Toolbar Component
 *
 * Task Group 18: Manual Layout Tools and Persistence
 * Subtask 18.2: Main toolbar with all layout tools
 *
 * Provides a horizontal toolbar containing all layout manipulation tools:
 * - Re-layout button
 * - Lock/unlock toggle
 * - Grid snap toggle
 * - Alignment tools
 *
 * Responsive design hides some elements on mobile.
 */

"use client"

import type { Node, Edge } from '@xyflow/react'
import { ReLayoutButton } from './re-layout-button'
import { LockToggle } from './lock-toggle'
import { GridSnapToggle } from './grid-snap-toggle'
import { AlignmentTools } from './alignment-tools'
import { Separator } from '@/components/ui/separator'

export interface LayoutToolbarProps {
  nodes: Node[]
  edges: Edge[]
  selectedNodes: Node[]
  onNodesChange: (nodes: Node[]) => void
  strategyId?: string
  isLocked: boolean
  onLockChange: (locked: boolean) => void
  snapToGrid: boolean
  onSnapToGridChange: (snap: boolean) => void
}

export function LayoutToolbar({
  nodes,
  edges,
  selectedNodes,
  onNodesChange,
  strategyId,
  isLocked,
  onLockChange,
  snapToGrid,
  onSnapToGridChange,
}: LayoutToolbarProps) {
  return (
    <div className="flex items-center gap-2 border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 py-2">
      <ReLayoutButton
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        isLocked={isLocked}
      />

      <Separator orientation="vertical" className="h-6" />

      <LockToggle
        isLocked={isLocked}
        onChange={onLockChange}
        strategyId={strategyId}
      />

      <Separator orientation="vertical" className="h-6" />

      <GridSnapToggle snapToGrid={snapToGrid} onChange={onSnapToGridChange} />

      <Separator orientation="vertical" className="h-6 hidden md:block" />

      <div className="hidden md:block">
        <AlignmentTools
          selectedNodes={selectedNodes}
          onNodesChange={onNodesChange}
        />
      </div>

      {selectedNodes.length > 1 && (
        <div className="ml-auto text-sm text-muted-foreground">
          {selectedNodes.length} nodes selected
        </div>
      )}
    </div>
  )
}
