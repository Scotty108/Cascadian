/**
 * Re-Layout Button Component
 *
 * Task Group 18: Manual Layout Tools and Persistence
 * Subtask 18.3: Re-layout button to re-run auto-layout
 *
 * Provides a button to manually trigger auto-layout on the current workflow.
 * Shows a confirmation dialog for large workflows (10+ nodes) before reorganizing.
 */

"use client"

import { Button } from '@/components/ui/button'
import { LayoutGrid } from 'lucide-react'
import { calculateAutoLayout } from '@/lib/workflow/layout/dagre-layout'
import { useToast } from '@/components/ui/use-toast'
import type { Node, Edge } from '@xyflow/react'

export interface ReLayoutButtonProps {
  nodes: Node[]
  edges: Edge[]
  onNodesChange: (nodes: Node[]) => void
  isLocked?: boolean
}

export function ReLayoutButton({
  nodes,
  edges,
  onNodesChange,
  isLocked = false,
}: ReLayoutButtonProps) {
  const { toast } = useToast()

  const handleReLayout = () => {
    // Check if layout is locked
    if (isLocked) {
      toast({
        title: 'Layout is locked',
        description: 'Unlock the layout to use auto-layout',
        variant: 'destructive',
      })
      return
    }

    // Check if there are nodes to layout
    if (nodes.length === 0) {
      toast({
        title: 'No nodes to layout',
        description: 'Add nodes to your strategy before using auto-layout',
        variant: 'destructive',
      })
      return
    }

    // Confirm dialog for large workflows
    if (nodes.length > 10) {
      if (
        !confirm(
          `Re-layout workflow with ${nodes.length} nodes? This will reorganize all nodes using the Dagre algorithm.`
        )
      ) {
        return
      }
    }

    try {
      // Convert ReactFlow nodes/edges to layout format
      const layoutNodes = nodes.map((node) => ({
        id: node.id,
        width: node.width || 200,
        height: node.height || 100,
      }))

      const layoutEdges = edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
      }))

      // Calculate new positions using Dagre
      const positions = calculateAutoLayout(layoutNodes, layoutEdges, {
        direction: 'LR', // Left-to-right layout
        rankSeparation: 150,
        nodeSeparation: 80,
      })

      // Update node positions
      const newNodes = nodes.map((node) => ({
        ...node,
        position: positions[node.id] || node.position,
      }))

      onNodesChange(newNodes)

      toast({
        title: 'Layout applied',
        description: `Reorganized ${nodes.length} nodes using Dagre algorithm`,
      })
    } catch (error) {
      console.error('Re-layout error:', error)
      toast({
        title: 'Layout failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleReLayout}
      disabled={nodes.length === 0}
      title="Auto-organize workflow using Dagre algorithm"
      className="gap-2"
    >
      <LayoutGrid className="h-4 w-4" />
      <span className="hidden md:inline">Re-layout</span>
    </Button>
  )
}
