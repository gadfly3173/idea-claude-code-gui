import { renderHook } from '@testing-library/react';
import { useFileTags } from './useFileTags.js';

function createEditable() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el as HTMLDivElement;
}

function mockSelection() {
  const selection = {
    removeAllRanges: vi.fn(),
    addRange: vi.fn(),
    rangeCount: 0,
  };
  vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection);
  return selection;
}

function setupHook(editable: HTMLDivElement, isComposingRef?: React.MutableRefObject<boolean>) {
  return renderHook(() =>
    useFileTags({
      editableRef: { current: editable },
      getTextContent: () => editable.textContent ?? '',
      onCloseCompletions: vi.fn(),
      isComposingRef,
    })
  );
}

describe('useFileTags', () => {
  it('renders file tags for valid references', () => {
    const editable = createEditable();
    editable.textContent = '@src/a.ts ';
    mockSelection();

    const { result } = setupHook(editable);

    result.current.pathMappingRef.current.set('src/a.ts', 'C:\\src\\a.ts');
    result.current.renderFileTags();

    expect(editable.querySelectorAll('.file-tag').length).toBe(1);
    expect(result.current.extractFileTags()).toEqual([
      { displayPath: 'src/a.ts', absolutePath: 'C:\\src\\a.ts' },
    ]);

    const close = editable.querySelector('.file-tag-close') as HTMLElement;
    close.click();
    expect(editable.querySelectorAll('.file-tag').length).toBe(0);
  });

  it('does not render tags for unknown references', () => {
    const editable = createEditable();
    editable.textContent = '@unknown/file.ts ';

    const { result } = setupHook(editable);

    result.current.renderFileTags();
    expect(editable.querySelectorAll('.file-tag').length).toBe(0);
  });

  it('renders file tags for paths with spaces', () => {
    const editable = createEditable();
    editable.textContent = '@my file.ts ';
    mockSelection();

    const { result } = setupHook(editable);

    result.current.pathMappingRef.current.set('my file.ts', '/abs/my file.ts');
    result.current.renderFileTags();

    expect(editable.querySelectorAll('.file-tag').length).toBe(1);
    expect(result.current.extractFileTags()).toEqual([
      { displayPath: 'my file.ts', absolutePath: '/abs/my file.ts' },
    ]);
  });

  it('selects longest matching path when multiple paths overlap', () => {
    const editable = createEditable();
    editable.textContent = '@src/my file.ts ';
    mockSelection();

    const { result } = setupHook(editable);

    result.current.pathMappingRef.current.set('src/my', '/abs/src/my');
    result.current.pathMappingRef.current.set('src/my file.ts', '/abs/src/my file.ts');
    result.current.renderFileTags();

    expect(editable.querySelectorAll('.file-tag').length).toBe(1);
    expect(result.current.extractFileTags()).toEqual([
      { displayPath: 'src/my file.ts', absolutePath: '/abs/src/my file.ts' },
    ]);
  });

  it('renders multiple file tags including ones with spaces', () => {
    const editable = createEditable();
    editable.textContent = '@src/a.ts @my doc.md ';
    mockSelection();

    const { result } = setupHook(editable);

    result.current.pathMappingRef.current.set('src/a.ts', '/abs/src/a.ts');
    result.current.pathMappingRef.current.set('my doc.md', '/abs/my doc.md');
    result.current.renderFileTags();

    expect(editable.querySelectorAll('.file-tag').length).toBe(2);
    expect(result.current.extractFileTags()).toEqual([
      { displayPath: 'src/a.ts', absolutePath: '/abs/src/a.ts' },
      { displayPath: 'my doc.md', absolutePath: '/abs/my doc.md' },
    ]);
  });

  it('handles path at end of text without trailing space', () => {
    const editable = createEditable();
    editable.textContent = '@src/a.ts';
    mockSelection();

    const { result } = setupHook(editable);

    result.current.pathMappingRef.current.set('src/a.ts', '/abs/src/a.ts');
    result.current.renderFileTags();

    expect(editable.querySelectorAll('.file-tag').length).toBe(1);
  });

  it('skips rendering during IME composition', () => {
    const editable = createEditable();
    editable.textContent = '@src/a.ts ';
    mockSelection();

    const isComposingRef = { current: true };
    const { result } = setupHook(editable, isComposingRef);

    result.current.pathMappingRef.current.set('src/a.ts', '/abs/src/a.ts');
    result.current.renderFileTags();

    // Should NOT render file tags during composition
    expect(editable.querySelectorAll('.file-tag').length).toBe(0);

    // After composition ends, should render normally
    isComposingRef.current = false;
    result.current.renderFileTags();

    expect(editable.querySelectorAll('.file-tag').length).toBe(1);
  });
});

