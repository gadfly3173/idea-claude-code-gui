import { resolveTriggerPosition } from './useTriggerDetection.js';

describe('useTriggerDetection', () => {
  it('falls back to selection rect when primary rect is null', () => {
    const element = document.createElement('div');
    const selectionRect = new DOMRect(120, 240, 18, 20);
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      getRangeAt: () => ({
        getBoundingClientRect: () => selectionRect,
      } as Range),
    } as unknown as Selection);

    const position = resolveTriggerPosition(element, 0, () => null);
    expect(position).toEqual({
      top: selectionRect.top,
      left: selectionRect.left,
      width: selectionRect.width,
      height: selectionRect.height,
    });

    getSelectionSpy.mockRestore();
  });

  it('falls back to selection rect when primary rect is all zeros', () => {
    const element = document.createElement('div');
    const selectionRect = new DOMRect(80, 120, 12, 16);
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      getRangeAt: () => ({
        getBoundingClientRect: () => selectionRect,
      } as Range),
    } as unknown as Selection);

    const position = resolveTriggerPosition(element, 0, () => new DOMRect(0, 0, 0, 0));
    expect(position).toEqual({
      top: selectionRect.top,
      left: selectionRect.left,
      width: selectionRect.width,
      height: selectionRect.height,
    });

    getSelectionSpy.mockRestore();
  });

  it('returns null when both primary rect and selection rect are invalid', () => {
    const element = document.createElement('div');
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      getRangeAt: () => ({
        getBoundingClientRect: () => new DOMRect(0, 0, 0, 0),
      } as Range),
    } as unknown as Selection);

    const position = resolveTriggerPosition(element, 0, () => new DOMRect(0, 0, 0, 0));
    expect(position).toBeNull();

    getSelectionSpy.mockRestore();
  });

  it('returns position from primary rect when valid', () => {
    const element = document.createElement('div');
    const rect = new DOMRect(50, 100, 10, 20);
    const position = resolveTriggerPosition(element, 0, () => rect);
    expect(position).toEqual({
      top: 100,
      left: 50,
      width: 10,
      height: 20,
    });
  });

  it('returns null when no selection range exists', () => {
    const element = document.createElement('div');
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 0,
    } as unknown as Selection);

    const position = resolveTriggerPosition(element, 0, () => null);
    expect(position).toBeNull();

    getSelectionSpy.mockRestore();
  });
});
