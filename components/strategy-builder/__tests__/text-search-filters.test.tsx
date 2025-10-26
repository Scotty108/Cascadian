/**
 * TEXT SEARCH FILTER TESTS
 *
 * Task Group 5.1: Tests for text search input component
 * Testing text search input rendering and case-sensitive toggle functionality
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import TextSearchInput from '../enhanced-filter-node/text-search-input';

describe('Text Search Input', () => {
  const mockOnChange = jest.fn();
  const mockOnCaseSensitiveChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Test 1: Text search input renders correctly
  test('renders text search input with search icon', () => {
    render(
      <TextSearchInput
        value="Trump"
        onChange={mockOnChange}
        caseSensitive={false}
        onCaseSensitiveChange={mockOnCaseSensitiveChange}
        operator="CONTAINS"
      />
    );

    // Should render the text input
    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('Trump');

    // Should have placeholder
    expect(input).toHaveAttribute('placeholder', 'Search text...');
  });

  // Test 2: Text value changes trigger onChange callback
  test('calls onChange when text value changes', () => {
    render(
      <TextSearchInput
        value=""
        onChange={mockOnChange}
        caseSensitive={false}
        onCaseSensitiveChange={mockOnCaseSensitiveChange}
        operator="CONTAINS"
      />
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Biden' } });

    expect(mockOnChange).toHaveBeenCalledWith('Biden');
  });

  // Test 3: Case-sensitive toggle renders and is interactive
  test('renders case-sensitive toggle checkbox', () => {
    render(
      <TextSearchInput
        value="Test"
        onChange={mockOnChange}
        caseSensitive={false}
        onCaseSensitiveChange={mockOnCaseSensitiveChange}
        operator="CONTAINS"
      />
    );

    // Should show case-sensitive label
    expect(screen.getByText('Case sensitive')).toBeInTheDocument();

    // Should have a checkbox/switch element
    const toggle = screen.getByRole('checkbox');
    expect(toggle).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
  });

  // Test 4: Case-sensitive toggle state changes
  test('calls onCaseSensitiveChange when toggle is clicked', () => {
    render(
      <TextSearchInput
        value="Test"
        onChange={mockOnChange}
        caseSensitive={false}
        onCaseSensitiveChange={mockOnCaseSensitiveChange}
        operator="STARTS_WITH"
      />
    );

    const toggle = screen.getByRole('checkbox');
    fireEvent.click(toggle);

    expect(mockOnCaseSensitiveChange).toHaveBeenCalledWith(true);
  });

  // Test 5: Displays different operators correctly
  test('works with STARTS_WITH operator', () => {
    const { rerender } = render(
      <TextSearchInput
        value="Will"
        onChange={mockOnChange}
        caseSensitive={false}
        onCaseSensitiveChange={mockOnCaseSensitiveChange}
        operator="STARTS_WITH"
      />
    );

    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('Will');

    // Test with ENDS_WITH operator
    rerender(
      <TextSearchInput
        value="election"
        onChange={mockOnChange}
        caseSensitive={false}
        onCaseSensitiveChange={mockOnCaseSensitiveChange}
        operator="ENDS_WITH"
      />
    );

    expect(input).toHaveValue('election');
  });

  // Test 6: Case-sensitive toggle persists state
  test('displays case-sensitive toggle in checked state when caseSensitive is true', () => {
    render(
      <TextSearchInput
        value="Test"
        onChange={mockOnChange}
        caseSensitive={true}
        onCaseSensitiveChange={mockOnCaseSensitiveChange}
        operator="CONTAINS"
      />
    );

    const toggle = screen.getByRole('checkbox');
    expect(toggle).toBeChecked();
  });
});
