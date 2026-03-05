export const RECENT_COMPOSITION_WINDOW_MS = 100;

export interface ShouldSubmitOnEnterOptions {
  isComposing: boolean;
  lastCompositionEndTime: number;
  isLoading: boolean;
  hasCompletionOpen: boolean;
  sendShortcut: 'enter' | 'cmdEnter';
  isEnterKey: boolean;
  hasModifier: boolean;
  isShiftPressed?: boolean;
  submittedOnEnter?: boolean;
  now?: number;
}

export function isRecentlyComposing(
  lastCompositionEndTime: number,
  now: number = Date.now(),
  windowMs: number = RECENT_COMPOSITION_WINDOW_MS
): boolean {
  return now - lastCompositionEndTime < windowMs;
}

export function shouldSubmitOnEnter({
  isComposing,
  lastCompositionEndTime,
  isLoading,
  hasCompletionOpen,
  sendShortcut,
  isEnterKey,
  hasModifier,
  isShiftPressed = false,
  submittedOnEnter = false,
  now = Date.now(),
}: ShouldSubmitOnEnterOptions): boolean {
  if (!isEnterKey) return false;
  if (submittedOnEnter) return false;
  if (isLoading) return false;
  if (hasCompletionOpen) return false;
  if (isComposing) return false;
  if (isRecentlyComposing(lastCompositionEndTime, now)) return false;

  if (sendShortcut === 'cmdEnter') {
    return hasModifier;
  }

  return !isShiftPressed;
}

