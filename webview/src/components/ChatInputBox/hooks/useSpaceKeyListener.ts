import { useEffect } from 'react';
import type { RefObject } from 'react';

export interface UseSpaceKeyListenerOptions {
  editableRef: React.RefObject<HTMLDivElement | null>;
  isComposingRef?: RefObject<boolean>;
  onKeyDown: (e: KeyboardEvent) => void;
}

/**
 * useSpaceKeyListener - Attaches a keydown listener for space-triggered tag rendering
 *
 * Uses native DOM listener to ensure consistent behavior across environments.
 */
export function useSpaceKeyListener({ editableRef, isComposingRef, onKeyDown }: UseSpaceKeyListenerOptions): void {
  useEffect(() => {
    const el = editableRef.current;
    if (!el) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isComposingRef?.current) return;
      onKeyDown(e);
    };

    el.addEventListener('keydown', handleKeyDown);
    return () => {
      el.removeEventListener('keydown', handleKeyDown);
    };
  }, [editableRef, isComposingRef, onKeyDown]);
}
