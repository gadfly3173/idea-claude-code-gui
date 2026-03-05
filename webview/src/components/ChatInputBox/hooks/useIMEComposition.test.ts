import { act, renderHook } from '@testing-library/react';
import { useIMEComposition } from './useIMEComposition.js';

describe('useIMEComposition', () => {
  it('toggles composing ref on composition start/end', () => {
    const handleInput = vi.fn();
    const { result } = renderHook(() => useIMEComposition({ handleInput }));

    act(() => {
      result.current.handleCompositionStart();
    });
    expect(result.current.isComposingRef.current).toBe(true);

    act(() => {
      result.current.handleCompositionEnd();
    });
    expect(result.current.isComposingRef.current).toBe(false);
  });

  it('runs fallback handleInput once after composition end', () => {
    vi.useFakeTimers();
    const handleInput = vi.fn();
    const { result } = renderHook(() => useIMEComposition({ handleInput }));

    act(() => {
      result.current.handleCompositionEnd();
      vi.advanceTimersByTime(120);
    });

    expect(handleInput).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('does not run fallback when canceled by normal input path', () => {
    vi.useFakeTimers();
    const handleInput = vi.fn();
    const { result } = renderHook(() => useIMEComposition({ handleInput }));

    act(() => {
      result.current.handleCompositionEnd();
      result.current.cancelPendingFallback();
      vi.advanceTimersByTime(120);
    });

    expect(handleInput).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('cancels pending fallback when new composition starts', () => {
    vi.useFakeTimers();
    const handleInput = vi.fn();
    const { result } = renderHook(() => useIMEComposition({ handleInput }));

    act(() => {
      result.current.handleCompositionEnd();
    });
    act(() => {
      result.current.handleCompositionStart();
      vi.advanceTimersByTime(200);
    });

    expect(handleInput).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

