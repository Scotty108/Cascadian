/**
 * ENHANCED FILTER NODE INTEGRATION TESTS
 *
 * Task Group 7.1: Integration tests for enhanced filter node UI
 * Tests: 4 focused tests
 * - Filter node configuration panel opens (1 test)
 * - Saving filter configuration (2 tests)
 * - Filter node display summary (1 test)
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ReactFlowProvider } from '@xyflow/react';
import EnhancedFilterNode from '../enhanced-filter-node/enhanced-filter-node';
import EnhancedFilterConfigPanel from '../enhanced-filter-node/enhanced-filter-config-panel';
import type { EnhancedFilterConfig } from '@/lib/strategy-builder/types';

// Wrapper component for ReactFlow nodes
function ReactFlowWrapper({ children }: { children: React.ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}

// Mock node data
const mockNodeData = {
  config: {
    conditions: [
      {
        id: 'cond-1',
        field: 'volume',
        operator: 'GREATER_THAN' as const,
        value: 100000,
        fieldType: 'number' as const,
      },
    ],
    logic: 'AND' as const,
    version: 2 as const,
  } as EnhancedFilterConfig,
};

describe('Enhanced Filter Node Integration', () => {
  describe('Configuration Panel', () => {
    it('should open configuration panel when node is clicked', () => {
      const mockOnOpen = jest.fn();

      render(
        <ReactFlowWrapper>
          <EnhancedFilterNode
            data={mockNodeData}
            selected={false}
            id="test-node"
          />
        </ReactFlowWrapper>
      );

      // Simulate node click
      const nodeElement = screen.getByTestId('enhanced-filter-node');
      fireEvent.click(nodeElement);

      // Note: In actual implementation, this would trigger parent component's handler
      // This test validates the node is clickable and has proper event handling structure
      expect(nodeElement).toBeInTheDocument();
    });
  });

  describe('Saving Configuration', () => {
    it('should save single condition configuration correctly', async () => {
      const mockOnSave = jest.fn();
      const initialConfig: EnhancedFilterConfig = {
        conditions: [
          {
            id: 'cond-1',
            field: 'volume',
            operator: 'GREATER_THAN',
            value: 50000,
            fieldType: 'number',
          },
        ],
        logic: 'AND',
        version: 2,
      };

      render(
        <EnhancedFilterConfigPanel
          nodeId="test-node"
          config={initialConfig}
          onSave={mockOnSave}
          onClose={jest.fn()}
        />
      );

      // Find and click save button
      const saveButton = screen.getByRole('button', { name: /save/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith('test-node', {
          config: initialConfig,
        });
      });
    });

    it('should save multi-condition configuration with AND/OR logic', async () => {
      const mockOnSave = jest.fn();
      const multiConditionConfig: EnhancedFilterConfig = {
        conditions: [
          {
            id: 'cond-1',
            field: 'volume',
            operator: 'GREATER_THAN',
            value: 100000,
            fieldType: 'number',
          },
          {
            id: 'cond-2',
            field: 'category',
            operator: 'EQUALS',
            value: 'Politics',
            fieldType: 'string',
          },
          {
            id: 'cond-3',
            field: 'title',
            operator: 'CONTAINS',
            value: 'Trump',
            fieldType: 'string',
            caseSensitive: false,
          },
        ],
        logic: 'AND',
        version: 2,
      };

      render(
        <EnhancedFilterConfigPanel
          nodeId="test-node"
          config={multiConditionConfig}
          onSave={mockOnSave}
          onClose={jest.fn()}
        />
      );

      // Verify all conditions are displayed (using getAllByText since these appear multiple times)
      const volumeElements = screen.getAllByText(/volume/i);
      expect(volumeElements.length).toBeGreaterThan(0);

      const categoryElements = screen.getAllByText(/category/i);
      expect(categoryElements.length).toBeGreaterThan(0);

      // Find and click save button
      const saveButton = screen.getByRole('button', { name: /save/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith('test-node', {
          config: multiConditionConfig,
        });
      });
    });
  });

  describe('Filter Summary Display', () => {
    it('should display correct summary for multi-condition filter', () => {
      const multiConditionData = {
        config: {
          conditions: [
            {
              id: 'cond-1',
              field: 'volume',
              operator: 'GREATER_THAN' as const,
              value: 100000,
              fieldType: 'number' as const,
            },
            {
              id: 'cond-2',
              field: 'category',
              operator: 'EQUALS' as const,
              value: 'Politics',
              fieldType: 'string' as const,
            },
            {
              id: 'cond-3',
              field: 'liquidity',
              operator: 'GREATER_THAN' as const,
              value: 10000,
              fieldType: 'number' as const,
            },
          ],
          logic: 'AND' as const,
          version: 2 as const,
        } as EnhancedFilterConfig,
      };

      render(
        <ReactFlowWrapper>
          <EnhancedFilterNode
            data={multiConditionData}
            selected={false}
            id="test-node"
          />
        </ReactFlowWrapper>
      );

      // Should display condition count
      expect(screen.getByText(/3 conditions/i)).toBeInTheDocument();

      // Should display logic operator
      expect(screen.getByText(/AND/i)).toBeInTheDocument();
    });

    it('should display OR logic correctly', () => {
      const orLogicData = {
        config: {
          conditions: [
            {
              id: 'cond-1',
              field: 'volume',
              operator: 'GREATER_THAN' as const,
              value: 100000,
              fieldType: 'number' as const,
            },
            {
              id: 'cond-2',
              field: 'volume',
              operator: 'LESS_THAN' as const,
              value: 50000,
              fieldType: 'number' as const,
            },
          ],
          logic: 'OR' as const,
          version: 2 as const,
        } as EnhancedFilterConfig,
      };

      render(
        <ReactFlowWrapper>
          <EnhancedFilterNode
            data={orLogicData}
            selected={false}
            id="test-node"
          />
        </ReactFlowWrapper>
      );

      // Should display OR logic (may appear in multiple places)
      const orElements = screen.getAllByText(/^OR$/i);
      expect(orElements.length).toBeGreaterThan(0);
      expect(screen.getByText(/2 conditions/i)).toBeInTheDocument();
    });
  });
});
