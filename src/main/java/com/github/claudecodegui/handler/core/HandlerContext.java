package com.github.claudecodegui.handler.core;

import com.github.claudecodegui.session.ClaudeSession;
import com.github.claudecodegui.provider.claude.ClaudeSDKBridge;
import com.github.claudecodegui.provider.codex.CodexSDKBridge;
import com.github.claudecodegui.settings.CodemossSettingsService;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.project.Project;
import com.intellij.ui.jcef.JBCefBrowser;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Handler context.
 * Provides all shared resources and callbacks needed by handlers.
 */
public class HandlerContext {

    public static final String DEFAULT_MODEL = "claude-sonnet-4-6";
    public static final String DEFAULT_PROVIDER = "claude";

    private static final Logger LOG = Logger.getInstance(HandlerContext.class);

    private final Project project;
    private final ClaudeSDKBridge claudeSDKBridge;
    private final CodexSDKBridge codexSDKBridge;
    private final CodemossSettingsService settingsService;
    private final JsCallback jsCallback;

    // Mutable state accessed via getters/setters — volatile for thread safety
    private volatile ClaudeSession session;
    private volatile JBCefBrowser browser;
    private volatile String currentModel = DEFAULT_MODEL;
    private volatile String currentProvider = DEFAULT_PROVIDER;
    private volatile boolean disposed = false;

    // Dispose callbacks let handlers that subscribe to JVM-wide singletons (e.g.
    // SdkOperationGate) deregister themselves when the chat window is closed.
    // CopyOnWriteArrayList because subscription is rare relative to traversal,
    // and a callback may itself try to add/remove during fire.
    private final List<Runnable> disposeListeners = new CopyOnWriteArrayList<>();
    private final Object disposeLock = new Object();

    /**
     * JavaScript callback interface.
     */
    public interface JsCallback {
        void callJavaScript(String functionName, String... args);
        String escapeJs(String str);
    }

    public HandlerContext(
            Project project,
            ClaudeSDKBridge claudeSDKBridge,
            CodexSDKBridge codexSDKBridge,
            CodemossSettingsService settingsService,
            JsCallback jsCallback
    ) {
        this.project = project;
        this.claudeSDKBridge = claudeSDKBridge;
        this.codexSDKBridge = codexSDKBridge;
        this.settingsService = settingsService;
        this.jsCallback = jsCallback;
    }

    // Getters
    public Project getProject() {
        return project;
    }

    public ClaudeSDKBridge getClaudeSDKBridge() {
        return claudeSDKBridge;
    }

    public CodexSDKBridge getCodexSDKBridge() {
        return codexSDKBridge;
    }

    public CodemossSettingsService getSettingsService() {
        return settingsService;
    }

    public ClaudeSession getSession() {
        return session;
    }

    public JBCefBrowser getBrowser() {
        return browser;
    }

    public String getCurrentModel() {
        return currentModel;
    }

    public String getCurrentProvider() {
        return currentProvider;
    }

    public boolean isDisposed() {
        return disposed;
    }

    // Setters
    public void setSession(ClaudeSession session) {
        this.session = session;
    }

    public void setBrowser(JBCefBrowser browser) {
        this.browser = browser;
    }

    public void setCurrentModel(String currentModel) {
        this.currentModel = currentModel;
    }

    public void setCurrentProvider(String currentProvider) {
        this.currentProvider = currentProvider;
    }

    public void setDisposed(boolean disposed) {
        List<Runnable> listenersToRun = null;
        synchronized (disposeLock) {
            boolean wasDisposed = this.disposed;
            this.disposed = disposed;
            // Fire dispose callbacks exactly once on the false→true edge. Idempotent
            // against repeat setDisposed(true) calls and inert on setDisposed(false)
            // (no existing call site does that, but the guard keeps it safe).
            if (disposed && !wasDisposed) {
                listenersToRun = new ArrayList<>(disposeListeners);
                disposeListeners.clear();
            }
        }

        if (listenersToRun != null) {
            for (Runnable listener : listenersToRun) {
                try {
                    listener.run();
                } catch (Throwable t) {
                    LOG.warn("[HandlerContext] Dispose listener threw: " + t.getMessage(), t);
                }
            }
        }
    }

    /**
     * Register a callback to be invoked when this context is disposed. Use this
     * to deregister handlers from JVM-wide singletons (e.g. SdkOperationGate) so
     * that listener lists don't leak across plugin reloads. Listeners fire once
     * on the false→true transition of {@link #disposed}; further registrations
     * after disposal run synchronously and are not retained.
     */
    public void addDisposeListener(Runnable listener) {
        if (listener == null) {
            return;
        }

        boolean runImmediately;
        synchronized (disposeLock) {
            runImmediately = disposed;
            if (!runImmediately) {
                disposeListeners.add(listener);
            }
        }

        if (runImmediately) {
            try {
                listener.run();
            } catch (Throwable t) {
                LOG.warn("[HandlerContext] Late dispose listener threw: " + t.getMessage(), t);
            }
        }
    }

    // JavaScript callback proxy methods
    public void callJavaScript(String functionName, String... args) {
        jsCallback.callJavaScript(functionName, args);
    }

    public String escapeJs(String str) {
        return jsCallback.escapeJs(str);
    }

    /**
     * Execute JavaScript on the EDT (Event Dispatch Thread).
     */
    public void executeJavaScriptOnEDT(String jsCode) {
        if (browser != null && !disposed) {
            ApplicationManager.getApplication().invokeLater(() -> {
                if (browser != null && !disposed) {
                    browser.getCefBrowser().executeJavaScript(jsCode, browser.getCefBrowser().getURL(), 0);
                }
            });
        }
    }
}
