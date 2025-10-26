/**
 * LAYOUT TOOLS TESTS
 *
 * Task Group 18.1: Tests for manual layout tools and persistence
 * Testing re-layout button, lock toggle, grid snap, and alignment tools
 */

import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ReLayoutButton } from '../re-layout-button'
import { LockToggle } from '../lock-toggle'
import { GridSnapToggle } from '../grid-snap-toggle'
import { AlignmentTools } from '../alignment-tools'
import type { Node } from '@xyflow/react'

// Mock the layout calculation
jest.mock('@/lib/workflow/layout/dagre-layout', () => ({
  calculateAutoLayout: jest.fn(() => ({
    'node-1': { x: 0, y: 0 },
    'node-2': { x: 250, y: 0 },
    'node-3': { x: 500, y: 0 },
  })),
}))

// Mock the persistence functions
jest.mock('@/lib/workflow/layout/layout-persistence', () => ({
  saveLockState: jest.fn(() => Promise.resolve()),
  saveNodePositions: jest.fn(() => Promise.resolve()),
}))

// Mock toast
const mockToast = jest.fn()
jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

// Mock confirm
global.confirm = jest.fn(() => true)

describe('Layout Tools', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // Test 1: Re-layout button calls calculateAutoLayout
  describe('ReLayoutButton', () => {
    test('re-layout button reorganizes nodes using Dagre', () => {
      const mockNodes: Node[] = [
        { id: 'node-1', type: 'DATA_SOURCE', position: { x: 100, y: 100 }, data: {} },
        { id: 'node-2', type: 'FILTER', position: { x: 200, y: 200 }, data: {} },
        { id: 'node-3', type: 'ACTION', position: { x: 300, y: 300 }, data: {} },
      ]

      const mockEdges = [
        { id: 'e1', source: 'node-1', target: 'node-2' },
        { id: 'e2', source: 'node-2', target: 'node-3' },
      ]

      const mockOnNodesChange = jest.fn()

      render(
        <ReLayoutButton
          nodes={mockNodes}
          edges={mockEdges}
          onNodesChange={mockOnNodesChange}
          isLocked={false}
        />
      )

      const button = screen.getByRole('button', { name: /re-layout/i })
      fireEvent.click(button)

      // Verify nodes were updated with new positions
      expect(mockOnNodesChange).toHaveBeenCalled()
      const updatedNodes = mockOnNodesChange.mock.calls[0][0]
      expect(updatedNodes[0].position).toEqual({ x: 0, y: 0 })
      expect(updatedNodes[1].position).toEqual({ x: 250, y: 0 })
      expect(updatedNodes[2].position).toEqual({ x: 500, y: 0 })

      // Verify toast was shown
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Layout applied',
        })
      )
    })

    test('re-layout button shows error when layout is locked', () => {
      const mockNodes: Node[] = [
        { id: 'node-1', type: 'DATA_SOURCE', position: { x: 100, y: 100 }, data: {} },
      ]

      const mockOnNodesChange = jest.fn()

      render(
        <ReLayoutButton
          nodes={mockNodes}
          edges={[]}
          onNodesChange={mockOnNodesChange}
          isLocked={true}
        />
      )

      const button = screen.getByRole('button', { name: /re-layout/i })
      fireEvent.click(button)

      // Verify error toast was shown
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Layout is locked',
          variant: 'destructive',
        })
      )

      // Verify nodes were not updated
      expect(mockOnNodesChange).not.toHaveBeenCalled()
    })
  })

  // Test 2: Lock toggle persists state
  describe('LockToggle', () => {
    test('lock toggle changes state and persists to database', async () => {
      const mockOnChange = jest.fn()
      const { saveLockState } = require('@/lib/workflow/layout/layout-persistence')

      render(
        <LockToggle
          isLocked={false}
          onChange={mockOnChange}
          strategyId="test-strategy-123"
        />
      )

      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Verify state change was triggered
      expect(mockOnChange).toHaveBeenCalledWith(true)

      // Verify persistence was called
      await waitFor(() => {
        expect(saveLockState).toHaveBeenCalledWith('test-strategy-123', true)
      })
    })

    test('lock toggle works without strategy ID', () => {
      const mockOnChange = jest.fn()

      render(<LockToggle isLocked={false} onChange={mockOnChange} />)

      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Verify state change was triggered
      expect(mockOnChange).toHaveBeenCalledWith(true)
    })
  })

  // Test 3: Grid snap toggle updates state
  describe('GridSnapToggle', () => {
    test('grid snap toggle enables and disables snap to grid', () => {
      const mockOnChange = jest.fn()

      const { rerender } = render(
        <GridSnapToggle snapToGrid={false} onChange={mockOnChange} />
      )

      const checkbox = screen.getByRole('checkbox')

      // Initially unchecked
      expect(checkbox).not.toBeChecked()

      // Click to enable
      fireEvent.click(checkbox)
      expect(mockOnChange).toHaveBeenCalledWith(true)

      // Rerender with new state
      rerender(<GridSnapToggle snapToGrid={true} onChange={mockOnChange} />)

      // Now checked
      expect(checkbox).toBeChecked()

      // Click to disable
      fireEvent.click(checkbox)
      expect(mockOnChange).toHaveBeenCalledWith(false)
    })
  })

  // Test 4: Alignment tools align selected nodes
  describe('AlignmentTools', () => {
    test('align left aligns all selected nodes to leftmost position', () => {
      const mockNodes: Node[] = [
        { id: 'node-1', type: 'DATA_SOURCE', position: { x: 100, y: 50 }, data: {}, selected: true },
        { id: 'node-2', type: 'FILTER', position: { x: 300, y: 100 }, data: {}, selected: true },
        { id: 'node-3', type: 'ACTION', position: { x: 200, y: 150 }, data: {}, selected: true },
      ]

      const mockOnNodesChange = jest.fn()

      render(<AlignmentTools selectedNodes={mockNodes} onNodesChange={mockOnNodesChange} />)

      const alignLeftButton = screen.getByTitle('Align left')
      fireEvent.click(alignLeftButton)

      // Verify all nodes were aligned to x=100 (leftmost)
      expect(mockOnNodesChange).toHaveBeenCalled()
      const updatedNodes = mockOnNodesChange.mock.calls[0][0]
      expect(updatedNodes[0].position.x).toBe(100)
      expect(updatedNodes[1].position.x).toBe(100)
      expect(updatedNodes[2].position.x).toBe(100)

      // Y positions should remain unchanged
      expect(updatedNodes[0].position.y).toBe(50)
      expect(updatedNodes[1].position.y).toBe(100)
      expect(updatedNodes[2].position.y).toBe(150)
    })

    test('align top aligns all selected nodes to topmost position', () => {
      const mockNodes: Node[] = [
        { id: 'node-1', type: 'DATA_SOURCE', position: { x: 100, y: 150 }, data: {}, selected: true },
        { id: 'node-2', type: 'FILTER', position: { x: 300, y: 50 }, data: {}, selected: true },
        { id: 'node-3', type: 'ACTION', position: { x: 200, y: 100 }, data: {}, selected: true },
      ]

      const mockOnNodesChange = jest.fn()

      render(<AlignmentTools selectedNodes={mockNodes} onNodesChange={mockOnNodesChange} />)

      const alignTopButton = screen.getByTitle('Align top')
      fireEvent.click(alignTopButton)

      // Verify all nodes were aligned to y=50 (topmost)
      expect(mockOnNodesChange).toHaveBeenCalled()
      const updatedNodes = mockOnNodesChange.mock.calls[0][0]
      expect(updatedNodes[0].position.y).toBe(50)
      expect(updatedNodes[1].position.y).toBe(50)
      expect(updatedNodes[2].position.y).toBe(50)

      // X positions should remain unchanged
      expect(updatedNodes[0].position.x).toBe(100)
      expect(updatedNodes[1].position.x).toBe(300)
      expect(updatedNodes[2].position.x).toBe(200)
    })

    test('alignment tools are disabled when less than 2 nodes selected', () => {
      const mockNodes: Node[] = [
        { id: 'node-1', type: 'DATA_SOURCE', position: { x: 100, y: 50 }, data: {}, selected: true },
      ]

      const mockOnNodesChange = jest.fn()

      render(<AlignmentTools selectedNodes={mockNodes} onNodesChange={mockOnNodesChange} />)

      const alignLeftButton = screen.getByTitle('Align left')
      expect(alignLeftButton).toBeDisabled()
    })
  })
})
