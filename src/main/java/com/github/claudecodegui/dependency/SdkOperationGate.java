package com.github.claudecodegui.dependency;

import com.github.claudecodegui.provider.claude.ClaudeSDKBridge;
import com.github.claudecodegui.ui.toolwindow.ClaudeChatWindow;
import com.github.claudecodegui.ui.toolwindow.ClaudeSDKToolWindow;
import com.intellij.openapi.diagnostic.Logger;

import java.util.List;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/**
 * JVM-wide coordination gate for SDK dependency operations (install/update/uninstall).
 *
 * <p>SDK files in {@code ~/.codemoss/dependencies/&lt;sdk-id&gt;/node_modules/...} are
 * dynamically imported by the long-running Node.js daemon process. On Windows, Node
 * holds an exclusive read lock on imported module files until the process exits, which
 * causes {@code npm install} (overwrite) and {@code Files.delete} (uninstall) to fail
 * with {@code AccessDeniedException} / "The process cannot access the file because it
 * is being used by another process".
 *
 * <p>This gate serializes SDK operations across the entire JVM and:
 * <ol>
 *   <li>Stops every {@link ClaudeSDKBridge}'s daemon before the operation runs.</li>
 *   <li>Blocks new daemon starts until the operation completes — see
 *       {@link ClaudeSDKBridge}'s daemon coordinator, which calls
 *       {@link #isLocked()} before spawning.</li>
 *   <li>Reentrant: nested calls on the same thread don't re-shutdown, allowing
 *       composite operations (e.g., update = uninstall + install).</li>
 * </ol>
 *
 * <p>The Node-side {@code sdkCache} in {@code ai-bridge/utils/sdk-loader.js} is
 * tied to the daemon process; restarting the daemon naturally clears it, so the
 * next request picks up the freshly installed SDK version.
 *
 * <p><b>Scope:</b> the gate only blocks the long-lived Claude daemon. Per-process
 * Node spawns (Codex, {@code NodeJsServiceCaller}, query/MCP executors) bypass
 * the {@link #isLocked()} check and could in theory still touch SDK files during
 * an operation. They are short-lived and {@link DependencyManager}'s delete retry
 * budget acts as a second line of defense, but the guarantee here is "no daemon
 * is running", not "no Node process touches the SDK directory".</p>
 *
 * <p>Thread model: the gate is a singleton; callers MUST hold the lock for the
 * full duration of the npm/IO operation by using {@link #runExclusively(Supplier)}.
 * Daemon shutdown happens on the calling thread before the operation runs — the
 * caller is expected to already be on a background executor (e.g.
 * {@code AppExecutorUtil.getAppExecutorService()}).
 */
public final class SdkOperationGate {

    private static final Logger LOG = Logger.getInstance(SdkOperationGate.class);
    private static final SdkOperationGate INSTANCE = new SdkOperationGate();

    // ReentrantLock so that an "update" operation (uninstall + install) holding the gate
    // can call into install() / uninstall() helpers that also acquire it.
    private final ReentrantLock lock = new ReentrantLock();
    // Read-side counter: number of threads currently inside runExclusively(). The daemon
    // coordinator checks this via isLocked() to refuse new daemon starts while an SDK
    // operation is in progress. AtomicInteger so the daemon coordinator can read it
    // without contending on the main lock.
    private final AtomicInteger activeOperations = new AtomicInteger(0);

    /**
     * Observer for lock state transitions. Fired only on rising/falling edge of the
     * "any operation in progress" condition — listeners do NOT see every nested
     * acquire/release. Implementations must be cheap and non-blocking; they run on
     * the operation thread that triggered the transition.
     */
    public interface StateListener {
        /**
         * @param locked {@code true} when the gate just became active (an operation
         *               started), {@code false} when the last operation finished.
         */
        void onStateChanged(boolean locked);
    }

    // CopyOnWriteArrayList so the rare add/remove never blocks readers (notify path
    // iterates while operations are in flight).
    private final List<StateListener> listeners = new CopyOnWriteArrayList<>();
    // Serializes "add + initial notify" against "broadcast fire" so a late-joining
    // listener can never receive both an initial onStateChanged(true) AND the
    // ongoing fire's onStateChanged(true) — choose one path atomically.
    private final Object notifyLock = new Object();

    private SdkOperationGate() {
    }

    public static SdkOperationGate getInstance() {
        return INSTANCE;
    }

    /**
     * Register a listener that is notified when the gate transitions between
     * locked and unlocked. Safe to call from any thread.
     *
     * <p>If the gate is currently locked at registration time, the listener
     * receives an immediate {@code onStateChanged(true)} so late-joining
     * subscribers (e.g. a new tab opened mid-install) see the correct state.
     *
     * <p>Concurrency: the {@code notifyLock} also gates the inc/dec+fire pair in
     * {@link #runExclusively}, so a listener can never receive both the synthetic
     * initial notify AND a redundant edge fire for the same operation.
     */
    public void addListener(StateListener listener) {
        if (listener == null) {
            return;
        }
        synchronized (notifyLock) {
            listeners.add(listener);
            if (activeOperations.get() > 0) {
                try {
                    listener.onStateChanged(true);
                } catch (Throwable t) {
                    LOG.warn("[SdkOperationGate] Newly-added listener threw on initial state: " + t.getMessage(), t);
                }
            }
        }
    }

    public void removeListener(StateListener listener) {
        if (listener != null) {
            listeners.remove(listener);
        }
    }

    /**
     * Fan out a state change. The caller MUST hold {@code notifyLock} — that's
     * how this method stays atomic against an interleaved {@link #addListener}.
     */
    private void fireStateChangedLocked(boolean locked) {
        // assert Thread.holdsLock(notifyLock);
        for (StateListener l : listeners) {
            try {
                l.onStateChanged(locked);
            } catch (Throwable t) {
                LOG.warn("[SdkOperationGate] Listener threw on state change: " + t.getMessage(), t);
            }
        }
    }

    /**
     * Returns {@code true} while an SDK operation is in progress on any thread.
     * Daemon coordinators consult this before starting a new daemon — see
     * {@code ClaudeDaemonCoordinator#getDaemonBridge}.
     */
    public boolean isLocked() {
        return activeOperations.get() > 0;
    }

    /**
     * Runs {@code operation} with all daemons across the JVM shut down and new
     * daemon starts blocked. Blocks until the lock is acquired.
     *
     * <p>The operation MUST NOT be invoked on the EDT — daemon shutdown waits for
     * reader/heartbeat threads to join, which can take a few seconds.
     */
    public <T> T runExclusively(Supplier<T> operation) {
        boolean topLevel = !lock.isHeldByCurrentThread();
        lock.lock();
        try {
            if (topLevel) {
                // Increment + fire(true) atomically under notifyLock so that any
                // addListener call interleaved here either sees activeOperations==0
                // (and waits for the fire) or sees ==1 already (and gets the
                // synthetic initial notify, skipping the broadcast).
                synchronized (notifyLock) {
                    activeOperations.incrementAndGet();
                    fireStateChangedLocked(true);
                }
                try {
                    shutdownAllDaemons();
                } catch (Throwable t) {
                    // Don't fail the operation just because daemon shutdown threw —
                    // log and continue. The npm step will surface a clearer error
                    // if files are still locked.
                    LOG.warn("[SdkOperationGate] Daemon shutdown raised: " + t.getMessage(), t);
                }
            }
            return operation.get();
        } finally {
            if (topLevel) {
                // Decrement BEFORE unlocking is safe: operation.get() has already
                // returned, so npm/delete has finished and the SDK files are no
                // longer in flux. A coordinator that wins the race to start a new
                // daemon at this point will load the freshly-installed SDK — which
                // is exactly what we want.
                synchronized (notifyLock) {
                    int remaining = activeOperations.decrementAndGet();
                    if (remaining == 0) {
                        fireStateChangedLocked(false);
                    }
                }
            }
            lock.unlock();
        }
    }

    /**
     * Shut down every daemon owned by any chat window in the JVM. Best-effort: a
     * shutdown that throws on one window doesn't block the others.
     *
     * <p>Reaching into ClaudeSDKToolWindow's registry instead of taking explicit
     * window arguments keeps callers (DependencyHandler) decoupled from UI layout.
     */
    private void shutdownAllDaemons() {
        Set<ClaudeChatWindow> windows = ClaudeSDKToolWindow.getAllChatWindows();
        if (windows.isEmpty()) {
            return;
        }
        LOG.info("[SdkOperationGate] Shutting down daemons for " + windows.size()
                + " chat window(s) before SDK operation");

        for (ClaudeChatWindow window : windows) {
            if (window == null || window.isDisposed()) {
                continue;
            }
            try {
                ClaudeSDKBridge claudeBridge = window.getClaudeSDKBridge();
                if (claudeBridge != null) {
                    claudeBridge.shutdownDaemon();
                }
            } catch (Throwable t) {
                LOG.warn("[SdkOperationGate] Failed to shutdown daemon for a window: " + t.getMessage());
            }
        }
    }
}
