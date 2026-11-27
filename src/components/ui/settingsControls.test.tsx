import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OptionSelect, type OptionSelectItem } from './OptionSelect';
import { SegmentedControl } from './SegmentedControl';
import { SettingSwitch } from './SettingSwitch';

const FRUITS: OptionSelectItem<'apple' | 'mango' | 'jackfruit'>[] = [
  { value: 'apple', label: 'Apple', badge: 'AP' },
  { value: 'mango', label: 'Mango', description: 'Summer king' },
  { value: 'jackfruit', label: 'Jackfruit', thumbnail: { background: 'green' } },
];

function ControlledSelect(props: {
  onPreview?: (v: string) => void;
  onChange?: (v: string) => void;
}) {
  const [value, setValue] = useState<'apple' | 'mango' | 'jackfruit'>('apple');
  return (
    <OptionSelect
      label="Fruit"
      value={value}
      options={FRUITS}
      testId="fruit"
      onChange={(v) => {
        setValue(v);
        props.onChange?.(v);
      }}
      onPreview={props.onPreview}
    />
  );
}

describe('OptionSelect', () => {
  afterEach(cleanup);

  it('shows the selected option and opens a listbox on click', () => {
    render(<ControlledSelect />);
    const trigger = screen.getByTestId('fruit-trigger');
    expect(trigger).toHaveTextContent('Apple');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Summer king')).toBeInTheDocument();
  });

  it('selects an option by click and closes', () => {
    const onChange = vi.fn();
    render(<ControlledSelect onChange={onChange} />);
    fireEvent.click(screen.getByTestId('fruit-trigger'));
    fireEvent.click(screen.getByTestId('fruit-option-mango'));
    expect(onChange).toHaveBeenCalledWith('mango');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByTestId('fruit-trigger')).toHaveTextContent('Mango');
  });

  it('supports keyboard navigation (ArrowDown, End, Enter, Escape)', () => {
    const onChange = vi.fn();
    render(<ControlledSelect onChange={onChange} />);
    const trigger = screen.getByTestId('fruit-trigger');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const list = screen.getByRole('listbox');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('mango');

    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'End' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('jackfruit');

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('previews an option without selecting it', () => {
    const onPreview = vi.fn();
    const onChange = vi.fn();
    render(<ControlledSelect onPreview={onPreview} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('fruit-preview'));
    expect(onPreview).toHaveBeenLastCalledWith('apple');

    fireEvent.click(screen.getByTestId('fruit-trigger'));
    fireEvent.click(screen.getByTestId('fruit-preview-jackfruit'));
    expect(onPreview).toHaveBeenLastCalledWith('jackfruit');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('closes when clicking outside', () => {
    render(
      <div>
        <ControlledSelect />
        <button type="button">outside</button>
      </div>
    );
    fireEvent.click(screen.getByTestId('fruit-trigger'));
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('SegmentedControl', () => {
  afterEach(cleanup);

  it('renders a radiogroup and changes on click and arrow keys', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Mode"
        value="light"
        testId="mode"
        onChange={onChange}
        options={[
          { value: 'system', label: 'Auto' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
      />
    );
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getByTestId('mode-light')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('mode-dark'));
    expect(onChange).toHaveBeenLastCalledWith('dark');
    fireEvent.keyDown(screen.getByTestId('mode-light'), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('system');
    fireEvent.keyDown(screen.getByTestId('mode-light'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('dark');
  });
});

describe('SettingSwitch', () => {
  afterEach(cleanup);

  it('toggles via an accessible switch', () => {
    const onChange = vi.fn();
    render(
      <SettingSwitch
        label="Tips"
        description="Show tips"
        checked={false}
        onChange={onChange}
        testId="tips"
      />
    );
    const sw = screen.getByRole('switch', { name: 'Tips' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
