/**
 * MULTI-CONDITION BUILDER TESTS
 *
 * Task Group 1.1: Tests for multi-condition filter builder
 * Testing adding/removing conditions, AND/OR logic, and validation
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import MultiConditionBuilder from '../enhanced-filter-node/multi-condition-builder';
import type { FilterCondition, FilterLogic } from '@/lib/strategy-builder/types';

describe('Multi-Condition Builder', () => {
  const mockOnChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Test 1: Adding conditions
  test('adds new condition when Add Condition button clicked', () => {
    const initialConditions: FilterCondition[] = [
      { id: '1', field: 'volume', operator: 'GREATER_THAN', value: 100000 }
    ];

    render(
      <MultiConditionBuilder
        conditions={initialConditions}
        logic="AND"
        onChange={mockOnChange}
      />
    );

    const addButton = screen.getByRole('button', { name: /add condition/i });
    fireEvent.click(addButton);

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({
        conditions: expect.arrayContaining([
          expect.objectContaining({ id: '1' }),
          expect.objectContaining({
            id: expect.any(String),
            field: '',
            operator: 'EQUALS',
            value: ''
          })
        ])
      })
    );
  });

  // Test 2: Removing conditions
  test('removes condition when remove button clicked', () => {
    const initialConditions: FilterCondition[] = [
      { id: '1', field: 'volume', operator: 'GREATER_THAN', value: 100000 },
      { id: '2', field: 'category', operator: 'EQUALS', value: 'Politics' }
    ];

    render(
      <MultiConditionBuilder
        conditions={initialConditions}
        logic="AND"
        onChange={mockOnChange}
      />
    );

    const removeButtons = screen.getAllByRole('button', { name: /remove/i });
    fireEvent.click(removeButtons[0]);

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({
        conditions: expect.arrayContaining([
          expect.objectContaining({ id: '2' })
        ])
      })
    );
    expect(mockOnChange.mock.calls[0][0].conditions).toHaveLength(1);
  });

  // Test 3: AND/OR logic switching
  test('switches between AND and OR logic', () => {
    const initialConditions: FilterCondition[] = [
      { id: '1', field: 'volume', operator: 'GREATER_THAN', value: 100000 },
      { id: '2', field: 'category', operator: 'EQUALS', value: 'Politics' }
    ];

    render(
      <MultiConditionBuilder
        conditions={initialConditions}
        logic="AND"
        onChange={mockOnChange}
      />
    );

    const logicToggle = screen.getByRole('button', { name: /and/i });
    fireEvent.click(logicToggle);

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({
        logic: 'OR'
      })
    );
  });

  // Test 4: Logic toggle displays correctly
  test('displays OR when logic is OR', () => {
    const initialConditions: FilterCondition[] = [
      { id: '1', field: 'volume', operator: 'GREATER_THAN', value: 100000 },
      { id: '2', field: 'category', operator: 'EQUALS', value: 'Politics' }
    ];

    render(
      <MultiConditionBuilder
        conditions={initialConditions}
        logic="OR"
        onChange={mockOnChange}
      />
    );

    // Find the button with OR logic
    const logicButton = screen.getByRole('button', { name: /toggle logic operator.*or/i });
    expect(logicButton).toBeInTheDocument();
    expect(logicButton).toHaveTextContent('OR');
  });

  // Test 5: Validates empty conditions
  test('prevents adding more than 10 conditions', () => {
    const maxConditions: FilterCondition[] = Array.from({ length: 10 }, (_, i) => ({
      id: `${i + 1}`,
      field: 'volume',
      operator: 'GREATER_THAN',
      value: 100000
    }));

    render(
      <MultiConditionBuilder
        conditions={maxConditions}
        logic="AND"
        onChange={mockOnChange}
      />
    );

    const addButton = screen.getByRole('button', { name: /add condition/i });
    expect(addButton).toBeDisabled();
  });

  // Test 6: Minimum conditions validation
  test('prevents removing last condition', () => {
    const singleCondition: FilterCondition[] = [
      { id: '1', field: 'volume', operator: 'GREATER_THAN', value: 100000 }
    ];

    render(
      <MultiConditionBuilder
        conditions={singleCondition}
        logic="AND"
        onChange={mockOnChange}
      />
    );

    const removeButton = screen.getByRole('button', { name: /remove/i });
    expect(removeButton).toBeDisabled();
  });

  // Test 7: Logic toggle only shows with multiple conditions
  test('hides logic toggle when only one condition exists', () => {
    const singleCondition: FilterCondition[] = [
      { id: '1', field: 'volume', operator: 'GREATER_THAN', value: 100000 }
    ];

    render(
      <MultiConditionBuilder
        conditions={singleCondition}
        logic="AND"
        onChange={mockOnChange}
      />
    );

    // Logic toggle should not be visible with only one condition
    expect(screen.queryByRole('button', { name: /and|or/i })).not.toBeInTheDocument();
  });

  // Test 8: Condition reordering (basic test for structure)
  test('renders all conditions in order', () => {
    const conditions: FilterCondition[] = [
      { id: '1', field: 'volume', operator: 'GREATER_THAN', value: 100000 },
      { id: '2', field: 'category', operator: 'EQUALS', value: 'Politics' },
      { id: '3', field: 'liquidity', operator: 'GREATER_THAN', value: 50000 }
    ];

    const { container } = render(
      <MultiConditionBuilder
        conditions={conditions}
        logic="AND"
        onChange={mockOnChange}
      />
    );

    // All three conditions should be rendered
    const conditionRows = container.querySelectorAll('[data-testid^="condition-row"]');
    expect(conditionRows).toHaveLength(3);
  });
});
