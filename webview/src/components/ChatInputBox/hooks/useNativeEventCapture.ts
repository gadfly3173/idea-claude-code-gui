import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { shouldSubmitOnEnter } from '../utils/submitGating.js';

interface CompletionOpenLike {
  isOpen: boolean;
}

export interface UseNativeEventCaptureOptions {
  editableRef: React.RefObject<HTMLDivElement | null>;
  isComposingRef: MutableRefObject<boolean>;
  lastCompositionEndTimeRef: MutableRefObject<number>;
  isLoading: boolean;
  sendShortcut: 'enter' | 'cmdEnter';
  fileCompletion: CompletionOpenLike;
  commandCompletion: CompletionOpenLike;
  agentCompletion: CompletionOpenLike;
  promptCompletion: CompletionOpenLike;
  dollarCommandCompletion: CompletionOpenLike;
  completionSelectedRef: MutableRefObject<boolean>;
  submittedOnEnterRef: MutableRefObject<boolean>;
  handleSubmit: () => void;
  handleEnhancePrompt: () => void;
}

/**
 * useNativeEventCapture - Native event capture for JCEF/IME edge cases
 *
 * Uses capturing listeners to handle:
 * - IME confirm enter false trigger
 * - beforeinput insertParagraph handling (Enter-to-send mode)
 * - prompt enhancer shortcut (Cmd+/)
 */
export function useNativeEventCapture({
  editableRef,
  isComposingRef,
  lastCompositionEndTimeRef,
  isLoading,
  sendShortcut,
  fileCompletion,
  commandCompletion,
  agentCompletion,
  promptCompletion,
  dollarCommandCompletion,
  completionSelectedRef,
  submittedOnEnterRef,
  handleSubmit,
  handleEnhancePrompt,
}: UseNativeEventCaptureOptions): void {
  // Keep latest values without re-subscribing native listeners on every render.
  const latestRef = useRef<UseNativeEventCaptureOptions>({
    editableRef,
    isComposingRef,
    lastCompositionEndTimeRef,
    isLoading,
    sendShortcut,
    fileCompletion,
    commandCompletion,
    agentCompletion,
    promptCompletion,
    dollarCommandCompletion,
    completionSelectedRef,
    submittedOnEnterRef,
    handleSubmit,
    handleEnhancePrompt,
  });
  latestRef.current = {
    editableRef,
    isComposingRef,
    lastCompositionEndTimeRef,
    isLoading,
    sendShortcut,
    fileCompletion,
    commandCompletion,
    agentCompletion,
    promptCompletion,
    dollarCommandCompletion,
    completionSelectedRef,
    submittedOnEnterRef,
    handleSubmit,
    handleEnhancePrompt,
  };

  useEffect(() => {
    const el = editableRef.current;
    if (!el) return;

    const nativeKeyDown = (ev: KeyboardEvent) => {
      const latest = latestRef.current;

      // NOTE: We intentionally do NOT set isComposingRef here based on keyCode 229.
      // IME composing state is managed exclusively by compositionStart/End events.
      // In JCEF, keyCode 229 is reported for ALL keys while the Korean IME is active,
      // including space, which is not an actual composition. Setting isComposingRef=true
      // here without a corresponding compositionEnd to clear it causes the ref to get
      // stuck, blocking handleInput and causing cursor jumping on space key.

      const isEnterKey = ev.key === 'Enter' || ev.keyCode === 13;

      if (ev.key === '/' && ev.metaKey && !ev.shiftKey && !ev.altKey) {
        ev.preventDefault();
        ev.stopPropagation();
        latest.handleEnhancePrompt();
        return;
      }

      const isMacCursorMovementOrDelete =
        (ev.key === 'ArrowLeft' && ev.metaKey) ||
        (ev.key === 'ArrowRight' && ev.metaKey) ||
        (ev.key === 'ArrowUp' && ev.metaKey) ||
        (ev.key === 'ArrowDown' && ev.metaKey) ||
        (ev.key === 'Backspace' && ev.metaKey);
      if (isMacCursorMovementOrDelete) return;

      const isCursorMovementKey =
        ev.key === 'Home' ||
        ev.key === 'End' ||
        ((ev.key === 'a' || ev.key === 'A') && ev.ctrlKey && !ev.metaKey) ||
        ((ev.key === 'e' || ev.key === 'E') && ev.ctrlKey && !ev.metaKey);
      if (isCursorMovementKey) return;

      const hasCompletionOpen =
        latest.fileCompletion.isOpen ||
        latest.commandCompletion.isOpen ||
        latest.agentCompletion.isOpen ||
        latest.promptCompletion.isOpen ||
        latest.dollarCommandCompletion.isOpen;
      const metaOrCtrl = ev.metaKey || ev.ctrlKey;
      const shift = ev.shiftKey === true;
      // Check both ref and native event isComposing property for edge cases
      // where composition event timing differs from browser's internal state
      const isIMEComposing = latest.isComposingRef.current || ev.isComposing;
      const isSendKey = shouldSubmitOnEnter({
        isComposing: isIMEComposing,
        lastCompositionEndTime: latest.lastCompositionEndTimeRef.current,
        isLoading: latest.isLoading,
        hasCompletionOpen,
        sendShortcut: latest.sendShortcut,
        isEnterKey,
        hasModifier: metaOrCtrl,
        isShiftPressed: shift,
        submittedOnEnter: latest.submittedOnEnterRef.current,
      });
      if (!isSendKey) return;

      ev.preventDefault();
      latest.submittedOnEnterRef.current = true;
      latest.handleSubmit();
    };

    const nativeKeyUp = (ev: KeyboardEvent) => {
      const latest = latestRef.current;
      const isEnterKey = ev.key === 'Enter' || ev.keyCode === 13;
      const shift = (ev as KeyboardEvent).shiftKey === true;
      const metaOrCtrl = ev.metaKey || ev.ctrlKey;

      const isSendKey =
        latest.sendShortcut === 'cmdEnter' ? isEnterKey && metaOrCtrl : isEnterKey && !shift;
      if (!isSendKey) return;

      ev.preventDefault();
      if (latest.completionSelectedRef.current) {
        latest.completionSelectedRef.current = false;
        return;
      }
      if (latest.submittedOnEnterRef.current) {
        latest.submittedOnEnterRef.current = false;
      }
    };

    const nativeBeforeInput = (ev: InputEvent) => {
      const latest = latestRef.current;
      const type = (ev as InputEvent).inputType;
      if (type !== 'insertParagraph') return;

      if (latest.sendShortcut === 'cmdEnter') return;

      ev.preventDefault();
      if (latest.completionSelectedRef.current) {
        latest.completionSelectedRef.current = false;
        return;
      }
      const hasCompletionOpen =
        latest.fileCompletion.isOpen ||
        latest.commandCompletion.isOpen ||
        latest.agentCompletion.isOpen ||
        latest.promptCompletion.isOpen ||
        latest.dollarCommandCompletion.isOpen;
      // Check both ref and native event isComposing property for edge cases
      // where composition event timing differs from browser's internal state
      const isIMEComposing = latest.isComposingRef.current || (ev as InputEvent).isComposing;
      const isSendKey = shouldSubmitOnEnter({
        isComposing: isIMEComposing,
        lastCompositionEndTime: latest.lastCompositionEndTimeRef.current,
        isLoading: latest.isLoading,
        hasCompletionOpen,
        sendShortcut: latest.sendShortcut,
        isEnterKey: true,
        hasModifier: false,
        submittedOnEnter: latest.submittedOnEnterRef.current,
      });
      if (!isSendKey) return;
      latest.submittedOnEnterRef.current = true;
      latest.handleSubmit();
      queueMicrotask(() => {
        if (latest.submittedOnEnterRef.current) {
          latest.submittedOnEnterRef.current = false;
        }
      });
    };

    el.addEventListener('keydown', nativeKeyDown, { capture: true });
    el.addEventListener('keyup', nativeKeyUp, { capture: true });
    el.addEventListener('beforeinput', nativeBeforeInput as EventListener, { capture: true });

    return () => {
      el.removeEventListener('keydown', nativeKeyDown, { capture: true });
      el.removeEventListener('keyup', nativeKeyUp, { capture: true });
      el.removeEventListener('beforeinput', nativeBeforeInput as EventListener, { capture: true });
    };
  }, [
    editableRef,
  ]);
}
