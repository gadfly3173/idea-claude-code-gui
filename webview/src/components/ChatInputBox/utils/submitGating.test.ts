import {
  shouldSubmitOnEnter,
  isRecentlyComposing,
  RECENT_COMPOSITION_WINDOW_MS,
} from './submitGating.js';
import type { ShouldSubmitOnEnterOptions } from './submitGating.js';

function baseOptions(overrides?: Partial<ShouldSubmitOnEnterOptions>): ShouldSubmitOnEnterOptions {
  return {
    isComposing: false,
    lastCompositionEndTime: Date.now() - 1000,
    isLoading: false,
    hasCompletionOpen: false,
    sendShortcut: 'enter',
    isEnterKey: true,
    hasModifier: false,
    isShiftPressed: false,
    submittedOnEnter: false,
    now: Date.now(),
    ...overrides,
  };
}

describe('isRecentlyComposing', () => {
  it('returns true within the composition window', () => {
    const endTime = 1000;
    const now = endTime + RECENT_COMPOSITION_WINDOW_MS - 1;
    expect(isRecentlyComposing(endTime, now)).toBe(true);
  });

  it('returns false after the composition window', () => {
    const endTime = 1000;
    const now = endTime + RECENT_COMPOSITION_WINDOW_MS;
    expect(isRecentlyComposing(endTime, now)).toBe(false);
  });

  it('returns false for very old composition end time', () => {
    expect(isRecentlyComposing(0, 5000)).toBe(false);
  });

  it('supports custom window size', () => {
    const endTime = 1000;
    expect(isRecentlyComposing(endTime, 1050, 200)).toBe(true);
    expect(isRecentlyComposing(endTime, 1200, 200)).toBe(false);
  });
});

describe('shouldSubmitOnEnter', () => {
  describe('basic submit (enter mode)', () => {
    it('allows submit on Enter in enter mode', () => {
      expect(shouldSubmitOnEnter(baseOptions())).toBe(true);
    });

    it('blocks submit when key is not Enter', () => {
      expect(shouldSubmitOnEnter(baseOptions({ isEnterKey: false }))).toBe(false);
    });

    it('blocks submit when Shift+Enter in enter mode', () => {
      expect(shouldSubmitOnEnter(baseOptions({ isShiftPressed: true }))).toBe(false);
    });
  });

  describe('cmdEnter mode', () => {
    it('allows submit with Cmd/Ctrl+Enter', () => {
      expect(shouldSubmitOnEnter(baseOptions({
        sendShortcut: 'cmdEnter',
        hasModifier: true,
      }))).toBe(true);
    });

    it('blocks submit on plain Enter without modifier', () => {
      expect(shouldSubmitOnEnter(baseOptions({
        sendShortcut: 'cmdEnter',
        hasModifier: false,
      }))).toBe(false);
    });
  });

  describe('IME composition guards', () => {
    it('blocks submit during composition', () => {
      expect(shouldSubmitOnEnter(baseOptions({ isComposing: true }))).toBe(false);
    });

    it('blocks submit within 100ms after composition end', () => {
      const now = Date.now();
      expect(shouldSubmitOnEnter(baseOptions({
        lastCompositionEndTime: now - 50,
        now,
      }))).toBe(false);
    });

    it('allows submit after 100ms post-composition window', () => {
      const now = Date.now();
      expect(shouldSubmitOnEnter(baseOptions({
        lastCompositionEndTime: now - RECENT_COMPOSITION_WINDOW_MS - 1,
        now,
      }))).toBe(true);
    });
  });

  describe('loading state', () => {
    it('blocks submit when loading', () => {
      expect(shouldSubmitOnEnter(baseOptions({ isLoading: true }))).toBe(false);
    });
  });

  describe('completion dropdown', () => {
    it('blocks submit when completion is open', () => {
      expect(shouldSubmitOnEnter(baseOptions({ hasCompletionOpen: true }))).toBe(false);
    });
  });

  describe('duplicate submit prevention', () => {
    it('blocks submit when already submitted via another path', () => {
      expect(shouldSubmitOnEnter(baseOptions({ submittedOnEnter: true }))).toBe(false);
    });
  });

  describe('guard priority (all guards active)', () => {
    it('blocks when multiple guards are active', () => {
      expect(shouldSubmitOnEnter(baseOptions({
        isComposing: true,
        isLoading: true,
        hasCompletionOpen: true,
        submittedOnEnter: true,
      }))).toBe(false);
    });
  });
});
