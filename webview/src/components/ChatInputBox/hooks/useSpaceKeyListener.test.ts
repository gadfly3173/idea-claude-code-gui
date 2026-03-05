import { renderHook } from '@testing-library/react';
import { useSpaceKeyListener } from './useSpaceKeyListener.js';

describe('useSpaceKeyListener', () => {
  it('attaches keydown listener and forwards events', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const onKeyDown = vi.fn();

    renderHook(() =>
      useSpaceKeyListener({
        editableRef: { current: el },
        onKeyDown,
      })
    );

    el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('skips forwarding keydown while composing', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const onKeyDown = vi.fn();

    renderHook(() =>
      useSpaceKeyListener({
        editableRef: { current: el },
        isComposingRef: { current: true },
        onKeyDown,
      })
    );

    el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(onKeyDown).not.toHaveBeenCalled();
  });
});
