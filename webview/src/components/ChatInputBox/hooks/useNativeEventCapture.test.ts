import { renderHook } from '@testing-library/react';
import { useNativeEventCapture } from './useNativeEventCapture.js';

describe('useNativeEventCapture', () => {
  const baseOptions = (el: HTMLDivElement) => ({
    editableRef: { current: el },
    isComposingRef: { current: false },
    lastCompositionEndTimeRef: { current: Date.now() - 1000 },
    isLoading: false,
    sendShortcut: 'enter' as const,
    fileCompletion: { isOpen: false },
    commandCompletion: { isOpen: false },
    agentCompletion: { isOpen: false },
    promptCompletion: { isOpen: false },
    dollarCommandCompletion: { isOpen: false },
    completionSelectedRef: { current: false },
    submittedOnEnterRef: { current: false },
    handleSubmit: vi.fn(),
    handleEnhancePrompt: vi.fn(),
  });

  it('submits on Enter in enter mode when no completions are open', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const options = baseOptions(el);

    renderHook(() =>
      useNativeEventCapture(options)
    );

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13 }));
    expect(options.handleSubmit).toHaveBeenCalledTimes(1);
    expect(options.submittedOnEnterRef.current).toBe(true);
  });

  it('does not submit when completion is open', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const options = baseOptions(el);
    options.fileCompletion.isOpen = true;

    renderHook(() =>
      useNativeEventCapture(options)
    );

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13 }));
    expect(options.handleSubmit).not.toHaveBeenCalled();
  });

  it('does not submit on keydown while composing (ref check)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const options = baseOptions(el);
    options.isComposingRef.current = true;

    renderHook(() =>
      useNativeEventCapture(options)
    );

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13 }));
    expect(options.handleSubmit).not.toHaveBeenCalled();
  });

  it('does not submit on keydown when native event isComposing is true', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const options = baseOptions(el);
    // ref is false but event isComposing is true - edge case
    options.isComposingRef.current = false;

    renderHook(() =>
      useNativeEventCapture(options)
    );

    // Simulate native event with isComposing property
    const event = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13 });
    Object.defineProperty(event, 'isComposing', { value: true, writable: false });
    el.dispatchEvent(event);
    expect(options.handleSubmit).not.toHaveBeenCalled();
  });

  it('does not submit on beforeinput while composing (ref check)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const options = baseOptions(el);
    options.isComposingRef.current = true;

    renderHook(() =>
      useNativeEventCapture(options)
    );

    el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertParagraph', bubbles: true, cancelable: true }));
    expect(options.handleSubmit).not.toHaveBeenCalled();
  });

  it('does not submit on beforeinput when native event isComposing is true', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const options = baseOptions(el);
    // ref is false but event isComposing is true - edge case
    options.isComposingRef.current = false;

    renderHook(() =>
      useNativeEventCapture(options)
    );

    // Simulate native InputEvent with isComposing property
    const event = new InputEvent('beforeinput', { inputType: 'insertParagraph', bubbles: true, cancelable: true });
    Object.defineProperty(event, 'isComposing', { value: true, writable: false });
    el.dispatchEvent(event);
    expect(options.handleSubmit).not.toHaveBeenCalled();
  });

  it('does not submit on beforeinput in recent composition window', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const options = baseOptions(el);
    options.lastCompositionEndTimeRef.current = Date.now();

    renderHook(() =>
      useNativeEventCapture(options)
    );

    el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertParagraph', bubbles: true, cancelable: true }));
    expect(options.handleSubmit).not.toHaveBeenCalled();
  });

  it('does not submit on beforeinput when already submitted in another path', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const options = baseOptions(el);
    options.submittedOnEnterRef.current = true;

    renderHook(() =>
      useNativeEventCapture(options)
    );

    el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertParagraph', bubbles: true, cancelable: true }));
    expect(options.handleSubmit).not.toHaveBeenCalled();
  });

  it('handles enhance prompt shortcut (Cmd+/)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const options = baseOptions(el);

    renderHook(() =>
      useNativeEventCapture(options)
    );

    el.dispatchEvent(new KeyboardEvent('keydown', { key: '/', metaKey: true }));
    expect(options.handleEnhancePrompt).toHaveBeenCalledTimes(1);
  });
});
