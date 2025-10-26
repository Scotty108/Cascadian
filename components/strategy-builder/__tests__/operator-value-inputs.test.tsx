/**
 * OPERATOR AND VALUE INPUT TESTS
 *
 * Task Group 3.1: Tests for operator selector and value input components
 * Testing operator filtering by field type and value input type switching
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import OperatorSelector from '../enhanced-filter-node/operator-selector';
import ValueInput from '../enhanced-filter-node/value-input';
import type { FilterOperator, FieldType } from '@/lib/strategy-builder/types';

describe('Operator Selector', () => {
  const mockOnChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Test 1: Number field operators
  test('shows numeric operators for number field type', () => {
    render(
      <OperatorSelector
        value="GREATER_THAN"
        onChange={mockOnChange}
        fieldType="number"
      />
    );

    // Open the select dropdown
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);

    // Should show numeric operators (use getAllByText since some may appear multiple times)
    const greaterThan = screen.getAllByText('>');
    expect(greaterThan.length).toBeGreaterThan(0);
    expect(screen.getByText('>=')).toBeInTheDocument();
    expect(screen.getByText('<')).toBeInTheDocument();
    expect(screen.getByText('<=')).toBeInTheDocument();
    const equals = screen.getAllByText('=');
    expect(equals.length).toBeGreaterThan(0);
    const notEquals = screen.getAllByText('!=');
    expect(notEquals.length).toBeGreaterThan(0);
    expect(screen.getByText('BETWEEN')).toBeInTheDocument();
  });

  // Test 2: String field operators
  test('shows string operators for string field type', () => {
    render(
      <OperatorSelector
        value="CONTAINS"
        onChange={mockOnChange}
        fieldType="string"
      />
    );

    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);

    // Should show string operators (some may appear multiple times)
    const equals = screen.getAllByText('=');
    expect(equals.length).toBeGreaterThan(0);
    const notEquals = screen.getAllByText('!=');
    expect(notEquals.length).toBeGreaterThan(0);
    const contains = screen.getAllByText('CONTAINS');
    expect(contains.length).toBeGreaterThan(0);
    expect(screen.getByText('STARTS WITH')).toBeInTheDocument();
    expect(screen.getByText('ENDS WITH')).toBeInTheDocument();
  });

  // Test 3: Array field operators
  test('shows array operators for array field type', () => {
    render(
      <OperatorSelector
        value="CONTAINS"
        onChange={mockOnChange}
        fieldType="array"
      />
    );

    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);

    // Should show array operators (CONTAINS may appear multiple times)
    const contains = screen.getAllByText('CONTAINS');
    expect(contains.length).toBeGreaterThan(0);
    expect(screen.getByText('HAS ANY')).toBeInTheDocument();
    expect(screen.getByText('HAS ALL')).toBeInTheDocument();
    expect(screen.getByText('IS EMPTY')).toBeInTheDocument();
  });

  // Test 4: Operator selection callback
  test('calls onChange when operator selected', () => {
    render(
      <OperatorSelector
        value="EQUALS"
        onChange={mockOnChange}
        fieldType="number"
      />
    );

    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);

    // Use getAllByText and click the last one (the one in the dropdown)
    const greaterThanOptions = screen.getAllByText('>');
    fireEvent.click(greaterThanOptions[greaterThanOptions.length - 1]);

    expect(mockOnChange).toHaveBeenCalledWith('GREATER_THAN');
  });
});

describe('Value Input', () => {
  const mockOnChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Test 5: Number input type
  test('renders number input for number field type', () => {
    render(
      <ValueInput
        value={100}
        onChange={mockOnChange}
        fieldType="number"
        operator="GREATER_THAN"
      />
    );

    const input = screen.getByRole('spinbutton');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveValue(100);
  });

  // Test 6: Text input type
  test('renders text input for string field type', () => {
    render(
      <ValueInput
        value="Politics"
        onChange={mockOnChange}
        fieldType="string"
        operator="EQUALS"
      />
    );

    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('Politics');
  });

  // Test 7: Range inputs for BETWEEN operator
  test('renders two inputs for BETWEEN operator', () => {
    render(
      <ValueInput
        value={[100, 500]}
        onChange={mockOnChange}
        fieldType="number"
        operator="BETWEEN"
      />
    );

    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toHaveValue(100);
    expect(inputs[1]).toHaveValue(500);
  });

  // Test 8: Value change callback
  test('calls onChange when value changes', () => {
    render(
      <ValueInput
        value={100}
        onChange={mockOnChange}
        fieldType="number"
        operator="GREATER_THAN"
      />
    );

    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '250' } });

    expect(mockOnChange).toHaveBeenCalledWith(250);
  });
});
