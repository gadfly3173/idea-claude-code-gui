import { renderHook } from '@testing-library/react';
import type React from 'react';
import { useKeyboardHandler } from './useKeyboardHandler.js';

function reactKeyEvent({
  key,
  metaKey = false,
  ctrlKey = false,
  shiftKey = false,
  isComposing = false,
}: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
}) {
  const e = {
    key,
    metaKey,
    ctrlKey,
    shiftKey,
    nativeEvent: { isComposing, key, keyCode: key === 'Enter' ? 13 : undefined },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  return e as unknown as React.KeyboardEvent<HTMLDivElement>;
}

describe('useKeyboardHandler', () => {
  const createOptions = () => ({
    isComposingRef: { current: false },
    lastCompositionEndTimeRef: { current: Date.now() - 1000 },
    sendShortcut: 'enter' as const,
    isLoading: false,
    fileCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
    commandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
    agentCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
    promptCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
    dollarCommandCompletion: { isOpen: false, handleKeyDown: vi.fn(() => false) },
    handleMacCursorMovement: vi.fn(() => false),
    handleHistoryKeyDown: vi.fn(() => false),
    completionSelectedRef: { current: false },
    submittedOnEnterRef: { current: false },
    handleSubmit: vi.fn(),
  });

  it('sends on Enter (enter mode) when allowed', () => {
    const options = createOptions();

    const { result } = renderHook(() =>
      useKeyboardHandler(options)
    );

    const e = reactKeyEvent({ key: 'Enter' });
    result.current.onKeyDown(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(options.handleSubmit).toHaveBeenCalledTimes(1);
    expect(options.submittedOnEnterRef.current).toBe(true);
  });

  it('does not send when completion handles Enter', () => {
    const options = createOptions();
    options.fileCompletion.isOpen = true;
    options.fileCompletion.handleKeyDown = vi.fn(() => true);

    const { result } = renderHook(() =>
      useKeyboardHandler(options)
    );

    const e = reactKeyEvent({ key: 'Enter' });
    result.current.onKeyDown(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
    expect(options.completionSelectedRef.current).toBe(true);
    expect(options.handleSubmit).not.toHaveBeenCalled();
  });

  it('does not send during composition', () => {
    const options = createOptions();
    options.isComposingRef.current = true;

    const { result } = renderHook(() =>
      useKeyboardHandler(options)
    );

    result.current.onKeyDown(reactKeyEvent({ key: 'Enter' }));
    expect(options.handleSubmit).not.toHaveBeenCalled();
  });

  it('does not send within 100ms after composition end', () => {
    const options = createOptions();
    options.lastCompositionEndTimeRef.current = Date.now();

    const { result } = renderHook(() =>
      useKeyboardHandler(options)
    );

    result.current.onKeyDown(reactKeyEvent({ key: 'Enter' }));
    expect(options.handleSubmit).not.toHaveBeenCalled();
  });

  it('does not send when already submitted in capture path', () => {
    const options = createOptions();
    options.submittedOnEnterRef.current = true;

    const { result } = renderHook(() =>
      useKeyboardHandler(options)
    );

    result.current.onKeyDown(reactKeyEvent({ key: 'Enter' }));
    expect(options.handleSubmit).not.toHaveBeenCalled();
  });

  it('resets submit refs on key up', () => {
    const options = createOptions();
    options.submittedOnEnterRef.current = true;

    const { result } = renderHook(() =>
      useKeyboardHandler(options)
    );

    const e = reactKeyEvent({ key: 'Enter' });
    result.current.onKeyUp(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(options.submittedOnEnterRef.current).toBe(false);
  });
});
