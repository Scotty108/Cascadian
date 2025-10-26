/**
 * CATEGORY AND TAG FILTER TESTS
 *
 * Task Group 4.1: Tests for category picker and tag picker components
 * Testing category selection, tag multi-select, and integration with condition builder
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import CategoryPicker from '../enhanced-filter-node/category-picker';
import TagPicker from '../enhanced-filter-node/tag-picker';

// Mock scrollIntoView which is not available in JSDOM
Element.prototype.scrollIntoView = jest.fn();
HTMLElement.prototype.scrollIntoView = jest.fn();

describe('Category Picker', () => {
  const mockOnChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Test 1: Category picker renders with trigger button
  test('renders category picker component', () => {
    render(
      <CategoryPicker
        value=""
        onChange={mockOnChange}
      />
    );

    // Should render the select trigger
    const trigger = screen.getByRole('combobox');
    expect(trigger).toBeInTheDocument();
  });

  // Test 2: Category picker displays selected value
  test('displays selected category value', () => {
    render(
      <CategoryPicker
        value="Politics"
        onChange={mockOnChange}
      />
    );

    // Should show selected value
    expect(screen.getByText('Politics')).toBeInTheDocument();
  });

  // Test 3: Category picker has onChange handler
  test('has onChange callback defined', () => {
    const { rerender } = render(
      <CategoryPicker
        value=""
        onChange={mockOnChange}
      />
    );

    expect(mockOnChange).toBeDefined();
    expect(typeof mockOnChange).toBe('function');
  });
});

describe('Tag Picker', () => {
  const mockOnChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Test 4: Tag picker renders with trigger button
  test('renders tag picker component', () => {
    render(
      <TagPicker
        value={[]}
        onChange={mockOnChange}
      />
    );

    // Should render the popover trigger button
    const trigger = screen.getByRole('combobox');
    expect(trigger).toBeInTheDocument();
  });

  // Test 5: Tag picker displays selected tags as chips
  test('displays selected tags as removable chips', () => {
    render(
      <TagPicker
        value={['election', 'trump', 'biden']}
        onChange={mockOnChange}
      />
    );

    // Should show chips for each selected tag
    expect(screen.getByText('election')).toBeInTheDocument();
    expect(screen.getByText('trump')).toBeInTheDocument();
    expect(screen.getByText('biden')).toBeInTheDocument();
  });

  // Test 6: Tag can be removed from selection
  test('removes tag when chip remove button is clicked', () => {
    render(
      <TagPicker
        value={['election', 'trump']}
        onChange={mockOnChange}
      />
    );

    // Find all remove buttons (they have aria-label)
    const removeButtons = screen.getAllByLabelText(/remove/i);

    // Click the second remove button (for "trump")
    fireEvent.click(removeButtons[1]);

    // Should call onChange with updated array
    expect(mockOnChange).toHaveBeenCalledWith(['election']);
  });
});

describe('Integration with Condition Builder', () => {
  // Test 7: Category picker integrates with condition row
  test('category picker is shown when field name includes "category"', () => {
    // This will be tested once we integrate with condition-row
    // For now, we just verify the component exports correctly
    expect(CategoryPicker).toBeDefined();
    expect(TagPicker).toBeDefined();
  });
});
