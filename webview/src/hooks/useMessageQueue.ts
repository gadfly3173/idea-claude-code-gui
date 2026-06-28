import { useState, useCallback, useRef, useEffect } from 'react';
import type { Attachment } from '../components/ChatInputBox/types';

export interface QueuedMessage {
  id: string;
  content: string;
  attachments?: Attachment[];
  queuedAt: number;
}

export interface UseMessageQueueOptions {
  /** Whether AI is currently processing */
  isLoading: boolean;
  /** Whether queued messages should wait even when loading is false */
  isPaused?: boolean | (() => boolean);
  /** Re-check pause state when an external pause source changes without re-rendering this hook's inputs */
  pauseVersion?: number;
  /** Callback to execute a message */
  onExecute: (content: string, attachments?: Attachment[]) => void;
}

export interface UseMessageQueueReturn {
  /** Current queue */
  queue: QueuedMessage[];
  /** Add message to queue */
  enqueue: (content: string, attachments?: Attachment[]) => void;
  /** Remove message from queue by id */
  dequeue: (id: string) => void;
  /** Clear entire queue */
  clearQueue: () => void;
  /** Whether queue has items */
  hasQueuedMessages: boolean;
}

/**
 * Hook for managing message queue
 * Automatically executes next message when loading completes
 */
export function useMessageQueue({
  isLoading,
  isPaused = false,
  pauseVersion = 0,
  onExecute,
}: UseMessageQueueOptions): UseMessageQueueReturn {
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const isExecutingFromQueueRef = useRef(false);
  const executeDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadingRef = useRef(isLoading);
  const isPausedRef = useRef(typeof isPaused === 'function' ? isPaused() : isPaused);
  const onExecuteRef = useRef(onExecute);

  // Generate unique ID
  const generateId = useCallback(() => {
    return `queue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  // Add message to queue
  const enqueue = useCallback((content: string, attachments?: Attachment[]) => {
    const newItem: QueuedMessage = {
      id: generateId(),
      content,
      attachments,
      queuedAt: Date.now(),
    };
    setQueue(prev => [...prev, newItem]);
  }, [generateId]);

  // Remove message from queue
  const dequeue = useCallback((id: string) => {
    setQueue(prev => prev.filter(item => item.id !== id));
  }, []);

  // Clear entire queue
  const clearQueue = useCallback(() => {
    setQueue([]);
  }, []);

  // Auto-execute next message when loading and pause state allow it
  useEffect(() => {
    isLoadingRef.current = isLoading;
    const paused = typeof isPaused === 'function' ? isPaused() : isPaused;
    isPausedRef.current = paused;
    onExecuteRef.current = onExecute;

    // If just finished loading and queue has items, execute next. When paused
    // (for example while SDK install/update/uninstall is holding the backend gate),
    // keep the item queued and wait for the next effect pass after pause releases.
    if (!isLoading && !paused && !isExecutingFromQueueRef.current && queue.length > 0) {
      const nextMessage = queue[0];
      isExecutingFromQueueRef.current = true;

      // Remove from queue first
      setQueue(prev => prev.slice(1));

      // Execute with small delay to ensure state updates
      executeDelayRef.current = setTimeout(() => {
        executeDelayRef.current = null;
        const pausedNow = typeof isPaused === 'function' ? isPaused() : isPausedRef.current;
        if (!isLoadingRef.current && !pausedNow) {
          onExecuteRef.current(nextMessage.content, nextMessage.attachments);
          isExecutingFromQueueRef.current = false;
          return;
        }
        // Put the item back at the front so newly enqueued messages stay behind it
        // and FIFO order is preserved if pause/loading flips during the delay.
        setQueue(prev => [nextMessage, ...prev]);
        isExecutingFromQueueRef.current = false;
      }, 50);
    }
  }, [isLoading, isPaused, pauseVersion, queue, onExecute]);

  useEffect(() => {
    return () => {
      if (executeDelayRef.current !== null) {
        clearTimeout(executeDelayRef.current);
      }
    };
  }, []);

  return {
    queue,
    enqueue,
    dequeue,
    clearQueue,
    hasQueuedMessages: queue.length > 0,
  };
}
