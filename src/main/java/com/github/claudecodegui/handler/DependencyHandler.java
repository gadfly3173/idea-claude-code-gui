package com.github.claudecodegui.handler;

import com.github.claudecodegui.handler.core.BaseMessageHandler;
import com.github.claudecodegui.handler.core.HandlerContext;

import com.github.claudecodegui.bridge.NodeDetector;
import com.github.claudecodegui.dependency.DependencyManager;
import com.github.claudecodegui.dependency.SdkOperationGate;
import com.github.claudecodegui.model.NodeDetectionResult;
import com.github.claudecodegui.dependency.InstallResult;
import com.github.claudecodegui.dependency.SdkDefinition;
import com.github.claudecodegui.dependency.UpdateInfo;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.intellij.ide.util.PropertiesComponent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.util.concurrency.AppExecutorUtil;

import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * SDK dependency management message handler.
 * Processes dependency install, uninstall, and update check requests from the frontend.
 */
public class DependencyHandler extends BaseMessageHandler {

    private static final Logger LOG = Logger.getInstance(DependencyHandler.class);
    private static final String NODE_PATH_PROPERTY_KEY = "claude.code.node.path";

    private static final String[] SUPPORTED_TYPES = {
        "get_dependency_status",      // Get all SDK statuses
        "install_dependency",         // Install SDK
        "uninstall_dependency",       // Uninstall SDK
        "update_dependency",          // Update SDK (uninstall + reinstall)
        "check_dependency_updates",   // Check for updates
        "get_dependency_versions",    // Get selectable versions
        "check_node_environment"      // Check Node.js environment
    };

    private final DependencyManager dependencyManager;
    private final Gson gson;
    private final NodeDetector nodeDetector;
    private volatile CompletableFuture<Void> initFuture;
    private final Object initLock;
    /**
     * Listener kept as a field so it can be deregistered when this handler's
     * HandlerContext is disposed (wired via {@code addDisposeListener} in the
     * constructor). SdkOperationGate is a JVM-wide singleton, so leaking
     * listeners would slowly bloat the notification fan-out list across plugin
     * reloads.
     */
    private final SdkOperationGate.StateListener gateListener;

    public DependencyHandler(HandlerContext context) {
        super(context);
        this.nodeDetector = NodeDetector.getInstance();
        this.dependencyManager = new DependencyManager(this.nodeDetector);
        this.gson = new Gson();
        this.initFuture = null;
        this.initLock = new Object();
        // Forward gate state transitions to the webview so the UI can pause sending
        // and show a "SDK busy" toast. Fired on the operation thread; we trampoline
        // to the EDT via callJavaScript.
        this.gateListener = locked -> this.sendSdkOperationState(locked);
        SdkOperationGate.getInstance().addListener(this.gateListener);
        // Deterministic deregistration when the chat window is disposed — without
        // this, every window close would leak a listener into the JVM-wide gate
        // singleton across plugin reloads.
        context.addDisposeListener(() -> SdkOperationGate.getInstance().removeListener(this.gateListener));
    }

    /**
     * Get the configured Node.js path from settings.
     */
    private String getConfiguredNodePath() {
        try {
            PropertiesComponent props = PropertiesComponent.getInstance();
            String savedPath = props.getValue(NODE_PATH_PROPERTY_KEY);
            if (savedPath != null && !savedPath.trim().isEmpty()) {
                return savedPath.trim();
            }
        } catch (Exception e) {
            LOG.warn("[DependencyHandler] Failed to get configured Node.js path: " + e.getMessage());
        }
        return null;
    }

    @Override
    public String[] getSupportedTypes() {
        return SUPPORTED_TYPES;
    }

    @Override
    public boolean handle(String type, String content) {
        this.ensureInitializedAsync();

        switch (type) {
            case "get_dependency_status":
                this.handleGetStatus();
                return true;
            case "install_dependency":
                this.handleInstall(content);
                return true;
            case "uninstall_dependency":
                this.handleUninstall(content);
                return true;
            case "update_dependency":
                this.handleUpdate(content);
                return true;
            case "check_dependency_updates":
                this.handleCheckUpdates(content);
                return true;
            case "get_dependency_versions":
                this.handleGetDependencyVersions(content);
                return true;
            case "check_node_environment":
                this.handleCheckNodeEnvironment();
                return true;
            default:
                return false;
        }
    }

    /**
     * Performs deferred Node.js cache warm-up for configured path.
     * After the first call, subsequent invocations reuse the same
     * (possibly completed) future as a one-shot initialization latch.
     */
    private void ensureInitializedAsync() {
        if (this.initFuture != null) {
            return;
        }

        synchronized (this.initLock) {
            if (this.initFuture != null) {
                return;
            }
            this.initFuture = CompletableFuture.runAsync(() -> {
            try {
                String configuredNodePath = this.getConfiguredNodePath();
                if (configuredNodePath == null || configuredNodePath.isEmpty()) {
                    return;
                }

                NodeDetectionResult result = this.nodeDetector.verifyAndCacheNodePath(configuredNodePath);
                if (result.isFound()) {
                    LOG.info("[DependencyHandler] Using configured Node.js path: " +
                             configuredNodePath + " (" + result.getNodeVersion() + ")");
                } else {
                    LOG.warn("[DependencyHandler] Configured Node.js path is invalid: " + configuredNodePath);
                }
            } catch (Exception e) {
                LOG.warn("[DependencyHandler] Lazy initialization failed: " + e.getMessage(), e);
            }
            }, AppExecutorUtil.getAppExecutorService()).exceptionally(ex -> {
                LOG.error("[DependencyHandler] Unexpected error in ensureInitializedAsync: " + ex.getMessage(), ex);
                return null;
            });
        }
    }

    /**
     * Get installation status of all SDKs.
     */
    private void handleGetStatus() {
        long startTime = System.currentTimeMillis();
        CompletableFuture.runAsync(() -> {
            try {
                JsonObject status = this.dependencyManager.getAllSdkStatus();
                String statusJson = this.gson.toJson(status);

                ApplicationManager.getApplication().invokeLater(() ->
                    this.callJavaScript("window.updateDependencyStatus", this.escapeJs(statusJson))
                );
            } catch (Exception e) {
                LOG.error("[DependencyHandler] Failed to get dependency status: " + e.getMessage(), e);
                this.sendErrorResult("updateDependencyStatus", e.getMessage());
                this.sendShowError("获取依赖状态失败: " + e.getMessage());
            } finally {
                long elapsed = System.currentTimeMillis() - startTime;
                LOG.debug("[DependencyHandler] handleGetStatus completed in " + elapsed +
                          "ms on thread " + Thread.currentThread().getName());
            }
        }, AppExecutorUtil.getAppExecutorService()).exceptionally(ex -> {
            LOG.error("[DependencyHandler] Unexpected error in handleGetStatus: " + ex.getMessage(), ex);
            return null;
        });
    }

    /**
     * Install SDK.
     */
    private void handleInstall(String content) {
        try {
            JsonObject json = this.gson.fromJson(content, JsonObject.class);
            String sdkId = json.get("id").getAsString();
            String requestedVersion = json.has("version") && !json.get("version").isJsonNull()
                    ? json.get("version").getAsString()
                    : null;

            SdkDefinition sdk = SdkDefinition.fromId(sdkId);
            if (sdk == null) {
                this.sendInstallResult(InstallResult.failure(sdkId, "Unknown SDK: " + sdkId, ""));
                return;
            }

            this.runInstallFlowAsync(sdkId, requestedVersion, null, "依赖安装失败: ", "handleInstall");

        } catch (Exception e) {
            LOG.error("[DependencyHandler] Failed to install dependency: " + e.getMessage(), e);
            this.sendErrorResult("dependencyInstallResult", e.getMessage());
            this.sendShowError("依赖安装失败: " + e.getMessage());
        }
    }

    /**
     * Uninstall SDK.
     */
    private void handleUninstall(String content) {
        try {
            JsonObject json = this.gson.fromJson(content, JsonObject.class);
            String sdkId = json.get("id").getAsString();

            CompletableFuture.runAsync(() -> {
                try {
                    // Stop every daemon before walking the SDK directory: on Windows,
                    // Node.js holds file handles on dynamically-imported .mjs / .js
                    // files, and Files.delete() would fail with AccessDeniedException.
                    boolean success = SdkOperationGate.getInstance().runExclusively(() ->
                        this.dependencyManager.uninstallSdk(sdkId)
                    );

                    JsonObject result = new JsonObject();
                    result.addProperty("success", success);
                    result.addProperty("sdkId", sdkId);
                    if (!success) {
                        result.addProperty("error", "Failed to uninstall SDK");
                    }

                    ApplicationManager.getApplication().invokeLater(() ->
                        this.callJavaScript("window.dependencyUninstallResult", this.escapeJs(this.gson.toJson(result)))
                    );

                    // Refresh status after uninstall completes
                    this.handleGetStatus();
                } catch (Exception e) {
                    LOG.error("[DependencyHandler] Failed during dependency uninstall: " + e.getMessage(), e);
                    this.sendErrorResult("dependencyUninstallResult", e.getMessage());
                    this.sendShowError("依赖卸载失败: " + e.getMessage());
                }
            }, AppExecutorUtil.getAppExecutorService()).exceptionally(ex -> {
                LOG.error("[DependencyHandler] Unexpected error in handleUninstall: " + ex.getMessage(), ex);
                return null;
            });

        } catch (Exception e) {
            LOG.error("[DependencyHandler] Failed to uninstall dependency: " + e.getMessage(), e);
            this.sendErrorResult("dependencyUninstallResult", e.getMessage());
            this.sendShowError("依赖卸载失败: " + e.getMessage());
        }
    }

    /**
     * Update SDK to the latest version within the supported version range.
     */
    private void handleUpdate(String content) {
        try {
            JsonObject json = this.gson.fromJson(content, JsonObject.class);
            String sdkId = json.get("id").getAsString();
            String requestedVersion = json.has("version") && !json.get("version").isJsonNull()
                    ? json.get("version").getAsString()
                    : null;

            SdkDefinition sdk = SdkDefinition.fromId(sdkId);
            if (sdk == null) {
                this.sendInstallResult(InstallResult.failure(sdkId, "Unknown SDK: " + sdkId, ""));
                return;
            }

            this.runInstallFlowAsync(
                sdkId,
                requestedVersion,
                "Updating SDK with npm install...",
                "依赖更新失败: ",
                "handleUpdate"
            );

        } catch (Exception e) {
            LOG.error("[DependencyHandler] Failed to update dependency: " + e.getMessage(), e);
            this.sendErrorResult("dependencyInstallResult", e.getMessage());
            this.sendShowError("依赖更新失败: " + e.getMessage());
        }
    }

    /**
     * Shared background install flow for {@link #handleInstall} and {@link #handleUpdate}.
     *
     * <p>Both code paths do the same work — Node env check, gate-wrapped
     * {@code installSdkSync}, result dispatch, status refresh — and differ only in a
     * pre-install progress message and the error-banner prefix. Keeping them in one
     * helper avoids the two implementations drifting in subtle ways (e.g. forgetting
     * to wrap a future change in the SdkOperationGate).
     *
     * @param sdkId                target SDK id
     * @param requestedVersion     specific version to install, or null for default
     * @param preInstallProgress   optional log line emitted before npm runs (null to skip)
     * @param errorPrefix          Chinese prefix used in the user-visible error banner
     * @param logContextName       short tag used in LOG.error messages for debugging
     */
    private void runInstallFlowAsync(
            String sdkId,
            String requestedVersion,
            String preInstallProgress,
            String errorPrefix,
            String logContextName
    ) {
        // Move the entire install flow (including Node env check) to background thread
        // to avoid blocking the CEF IO thread if the cache is cold.
        CompletableFuture.runAsync(() -> {
            try {
                // Check Node.js environment (may involve process I/O on cache miss)
                if (!this.dependencyManager.checkNodeEnvironment()) {
                    JsonObject errorResult = new JsonObject();
                    errorResult.addProperty("success", false);
                    errorResult.addProperty("sdkId", sdkId);
                    errorResult.addProperty("error", "node_not_configured");
                    errorResult.addProperty(
                        "message",
                        "Node.js not configured. Please set Node.js path in Settings > Basic."
                    );

                    ApplicationManager.getApplication().invokeLater(() ->
                        this.callJavaScript(
                            "window.dependencyInstallResult",
                            this.escapeJs(this.gson.toJson(errorResult))
                        )
                    );
                    return;
                }

                if (preInstallProgress != null) {
                    this.sendInstallProgress(sdkId, preInstallProgress);
                }

                // Run install under the gate so every daemon is stopped first and
                // no new daemon can spawn until npm finishes — otherwise Node would
                // keep the SDK's .mjs files locked on Windows and the install would
                // fail with EBUSY/EPERM.
                InstallResult result = SdkOperationGate.getInstance().runExclusively(() ->
                    this.dependencyManager.installSdkSync(sdkId, requestedVersion, (logLine) ->
                        this.sendInstallProgress(sdkId, logLine)
                    )
                );

                this.sendInstallResult(result);

                // Refresh status after the operation completes
                if (result.isSuccess()) {
                    this.handleGetStatus();
                }
            } catch (Exception e) {
                LOG.error("[DependencyHandler] Failed during dependency "
                        + logContextName + ": " + e.getMessage(), e);
                this.sendErrorResult("dependencyInstallResult", e.getMessage());
                this.sendShowError(errorPrefix + e.getMessage());
            }
        }, AppExecutorUtil.getAppExecutorService()).exceptionally(ex -> {
            LOG.error("[DependencyHandler] Unexpected error in "
                    + logContextName + ": " + ex.getMessage(), ex);
            return null;
        });
    }

    /**
     * Check for SDK updates.
     */
    private void handleCheckUpdates(String content) {
        try {
            String sdkId = null;
            if (content != null && !content.isEmpty()) {
                JsonObject json = this.gson.fromJson(content, JsonObject.class);
                if (json.has("id")) {
                    sdkId = json.get("id").getAsString();
                }
            }

            final String targetSdkId = sdkId;

            CompletableFuture.runAsync(() -> {
                try {
                    JsonObject updates = new JsonObject();

                    if (targetSdkId != null) {
                        // Check specified SDK
                        UpdateInfo info = this.dependencyManager.checkForUpdates(targetSdkId);
                        updates.add(targetSdkId, this.toJson(info));
                    } else {
                        // Check all installed SDKs
                        for (SdkDefinition sdk : SdkDefinition.values()) {
                            if (this.dependencyManager.isInstalled(sdk.getId())) {
                                UpdateInfo info = this.dependencyManager.checkForUpdates(sdk.getId());
                                updates.add(sdk.getId(), this.toJson(info));
                            }
                        }
                    }

                    ApplicationManager.getApplication().invokeLater(
                        () -> this.callJavaScript(
                            "window.dependencyUpdateAvailable",
                            this.escapeJs(this.gson.toJson(updates))
                        )
                    );
                } catch (Exception e) {
                    LOG.error("[DependencyHandler] Failed during update check: " + e.getMessage(), e);
                    this.sendErrorResult("dependencyUpdateAvailable", e.getMessage());
                    this.sendShowError("检查依赖更新失败: " + e.getMessage());
                }
            }, AppExecutorUtil.getAppExecutorService()).exceptionally(ex -> {
                LOG.error("[DependencyHandler] Unexpected error in handleCheckUpdates: " + ex.getMessage(), ex);
                return null;
            });

        } catch (Exception e) {
            LOG.error("[DependencyHandler] Failed to check updates: " + e.getMessage(), e);
            this.sendErrorResult("dependencyUpdateAvailable", e.getMessage());
            this.sendShowError("检查依赖更新失败: " + e.getMessage());
        }
    }

    private void handleGetDependencyVersions(String content) {
        try {
            String sdkId = null;
            if (content != null && !content.isEmpty()) {
                JsonObject json = this.gson.fromJson(content, JsonObject.class);
                if (json.has("id")) {
                    sdkId = json.get("id").getAsString();
                }
            }

            final String targetSdkId = sdkId;
            CompletableFuture.runAsync(() -> {
                try {
                    JsonObject payload = new JsonObject();
                    if (targetSdkId != null) {
                        payload.add(targetSdkId, this.buildVersionPayload(targetSdkId));
                    } else {
                        for (SdkDefinition sdk : SdkDefinition.values()) {
                            payload.add(sdk.getId(), this.buildVersionPayload(sdk.getId()));
                        }
                    }

                    ApplicationManager.getApplication().invokeLater(
                        () -> this.callJavaScript(
                            "window.dependencyVersionsLoaded",
                            this.escapeJs(this.gson.toJson(payload))
                        )
                    );
                } catch (Exception e) {
                    LOG.error("[DependencyHandler] Failed to get dependency versions: " + e.getMessage(), e);
                    this.sendErrorResult("dependencyVersionsLoaded", e.getMessage());
                }
            }, AppExecutorUtil.getAppExecutorService()).exceptionally(ex -> {
                LOG.error("[DependencyHandler] Unexpected error in handleGetDependencyVersions: " + ex.getMessage(), ex);
                return null;
            });
        } catch (Exception e) {
            LOG.error("[DependencyHandler] Failed to parse dependency versions request: " + e.getMessage(), e);
            this.sendErrorResult("dependencyVersionsLoaded", e.getMessage());
        }
    }

    /**
     * Check Node.js environment.
     * Prefers the configured Node.js path; falls back to auto-detection if not configured.
     */
    private void handleCheckNodeEnvironment() {
        long startTime = System.currentTimeMillis();
        CompletableFuture.runAsync(() -> {
            try {
                boolean available = false;
                String detectedPath = null;
                String detectedVersion = null;

                // Fast-path: use cached shared detection result with no process/file I/O.
                String cachedPath = this.nodeDetector.getCachedNodePath();
                String cachedVersion = this.nodeDetector.getCachedNodeVersion();
                if (cachedPath != null && cachedVersion != null) {
                    available = true;
                    detectedPath = cachedPath;
                    detectedVersion = cachedVersion;
                }

                // If cache miss, first check if there is a configured Node.js path.
                if (!available) {
                    String configuredPath = this.getConfiguredNodePath();
                    if (configuredPath != null && !configuredPath.isEmpty()) {
                        NodeDetectionResult verifyResult =
                            this.nodeDetector.verifyAndCacheNodePath(configuredPath);
                        if (verifyResult.isFound()) {
                            available = true;
                            detectedPath = verifyResult.getNodePath();
                            detectedVersion = verifyResult.getNodeVersion();
                            LOG.info("[DependencyHandler] Node.js found at configured path: " +
                                     configuredPath + " (" + detectedVersion + ")");
                        } else {
                            LOG.warn("[DependencyHandler] Configured Node.js path is invalid: " + configuredPath);
                        }
                    }
                }

                // If the configured path is invalid, try auto-detection
                if (!available) {
                    available = this.dependencyManager.checkNodeEnvironment();
                    if (available) {
                        detectedPath = this.nodeDetector.getCachedNodePath();
                        detectedVersion = this.nodeDetector.getCachedNodeVersion();
                    }
                }

                JsonObject result = new JsonObject();
                result.addProperty("available", available);
                if (detectedPath != null) {
                    result.addProperty("path", detectedPath);
                }
                if (detectedVersion != null) {
                    result.addProperty("version", detectedVersion);
                }

                this.sendNodeEnvironmentStatus(result);
            } catch (Exception e) {
                LOG.error("[DependencyHandler] Failed to check Node environment: " + e.getMessage(), e);
                JsonObject result = new JsonObject();
                result.addProperty("available", false);
                result.addProperty("error", e.getMessage());
                this.sendNodeEnvironmentStatus(result);
                this.sendShowError("检查 Node.js 环境失败: " + e.getMessage());
            } finally {
                long elapsed = System.currentTimeMillis() - startTime;
                LOG.debug("[DependencyHandler] handleCheckNodeEnvironment completed in " + elapsed +
                          "ms on thread " + Thread.currentThread().getName());
            }
        }, AppExecutorUtil.getAppExecutorService()).exceptionally(ex -> {
            LOG.error("[DependencyHandler] Unexpected error in handleCheckNodeEnvironment: " + ex.getMessage(), ex);
            return null;
        });
    }

    // ==================== Helper Methods ====================

    /**
     * Notify the webview that an SDK operation has started or finished.
     * The frontend uses this to disable chat sending and surface a toast —
     * during the operation the Claude daemon is down, so any message would
     * fall back to slow per-process mode without runtime context.
     *
     * <p>Trampolines to the EDT because callJavaScript ultimately invokes
     * {@code JBCefBrowser.executeJavaScript}, which must run there.
     *
     * <p>Primary cleanup happens via {@code HandlerContext.addDisposeListener}
     * (wired in the constructor). The {@code isDisposed()} check here is a
     * defense-in-depth: if a fire is in flight when dispose runs, this short-
     * circuits before touching a dead browser.
     */
    private void sendSdkOperationState(boolean locked) {
        if (this.context.isDisposed()) {
            return;
        }

        JsonObject payload = new JsonObject();
        payload.addProperty("locked", locked);
        String payloadJson = this.gson.toJson(payload);

        ApplicationManager.getApplication().invokeLater(() -> {
            if (this.context.isDisposed()) {
                return;
            }
            this.callJavaScript("window.onSdkOperationStateChange", this.escapeJs(payloadJson));
        });
    }

    private void sendNodeEnvironmentStatus(JsonObject result) {
        ApplicationManager.getApplication().invokeLater(() ->
            this.callJavaScript("window.nodeEnvironmentStatus", this.escapeJs(this.gson.toJson(result)))
        );
    }

    private void sendInstallProgress(String sdkId, String logLine) {
        JsonObject progress = new JsonObject();
        progress.addProperty("sdkId", sdkId);
        progress.addProperty("log", logLine);

        ApplicationManager.getApplication().invokeLater(
            () -> this.callJavaScript(
                "window.dependencyInstallProgress",
                this.escapeJs(this.gson.toJson(progress))
            )
        );
    }

    private void sendInstallResult(InstallResult result) {
        JsonObject json = new JsonObject();
        json.addProperty("success", result.isSuccess());
        json.addProperty("sdkId", result.getSdkId());

        if (result.isSuccess()) {
            json.addProperty("installedVersion", result.getInstalledVersion());
        } else {
            json.addProperty("error", result.getErrorMessage());
        }
        json.addProperty("logs", result.getLogs());

        ApplicationManager.getApplication().invokeLater(() ->
            this.callJavaScript("window.dependencyInstallResult", this.escapeJs(this.gson.toJson(json)))
        );
    }

    private JsonObject toJson(UpdateInfo info) {
        JsonObject json = new JsonObject();
        json.addProperty("sdkId", info.getSdkId());
        json.addProperty("sdkName", info.getSdkName());
        json.addProperty("hasUpdate", info.hasUpdate());
        json.addProperty("currentVersion", info.getCurrentVersion());
        json.addProperty("latestVersion", info.getLatestVersion());

        if (info.getErrorMessage() != null) {
            json.addProperty("error", info.getErrorMessage());
        }

        return json;
    }

    private JsonObject buildVersionPayload(String sdkId) {
        JsonObject json = new JsonObject();
        List<String> remoteVersions = this.dependencyManager.getAvailableVersions(sdkId);
        List<String> fallbackVersions = this.dependencyManager.getFallbackVersions(sdkId);
        boolean usingRemote = !remoteVersions.isEmpty();
        List<String> effectiveVersions = usingRemote ? remoteVersions : fallbackVersions;

        json.addProperty("sdkId", sdkId);
        json.add("versions", this.gson.toJsonTree(effectiveVersions));
        json.add("fallbackVersions", this.gson.toJsonTree(fallbackVersions));
        json.addProperty("source", usingRemote ? "remote" : "fallback");

        String latestVersion = this.dependencyManager.getLatestVersion(sdkId);
        if (latestVersion != null && !latestVersion.isEmpty()) {
            json.addProperty("latestVersion", latestVersion);
        }

        if (!usingRemote) {
            json.addProperty("error", "remote_versions_unavailable");
        }

        return json;
    }

    private void sendShowError(String message) {
        ApplicationManager.getApplication().invokeLater(() ->
            this.callJavaScript("window.showError", this.escapeJs(message))
        );
    }

    private void sendErrorResult(String callback, String errorMessage) {
        JsonObject error = new JsonObject();
        error.addProperty("success", false);
        error.addProperty("error", errorMessage);

        ApplicationManager.getApplication().invokeLater(() ->
            this.callJavaScript("window." + callback, this.escapeJs(this.gson.toJson(error)))
        );
    }
}
