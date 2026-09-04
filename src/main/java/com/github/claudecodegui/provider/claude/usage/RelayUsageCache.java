package com.github.claudecodegui.provider.claude.usage;

import com.google.gson.JsonObject;

/**
 * Payload cache shared by all relay usage vendors (one active account per
 * vendor at a time, so a single entry keyed by vendor + endpoint + credential
 * suffices).
 *
 * <p>Serves three roles, mirroring the original z.ai-only cache:
 * <ul>
 *   <li><b>fresh</b> — probe result within {@link #TTL_MS}, served verbatim;</li>
 *   <li><b>stale</b> — last good payload after a failed probe, served for at
 *       most {@link #STALE_MAX_MS} and flagged {@code stale: true} so the UI can
 *       mark it, then given up on (a long outage must not masquerade as live
 *       data);</li>
 *   <li>cache misses simply fall through to the caller's fallback chain.</li>
 * </ul>
 */
final class RelayUsageCache {

    /** Fresh TTL, set just under the webview's 120s poll cadence. */
    static final long TTL_MS = 115_000L;
    /** Max age for serving a stale payload after repeated probe failures. */
    static final long STALE_MAX_MS = 30 * 60_000L;

    private static volatile Entry entry;

    private RelayUsageCache() {
    }

    /** Fresh cached payload for {@code key}, or null when absent/expired. */
    static JsonObject fresh(String key, long nowMs) {
        Entry c = entry;
        if (c != null && c.key.equals(key) && nowMs - c.atMs < TTL_MS) {
            return c.payload.deepCopy();
        }
        return null;
    }

    /** Stale cached payload (flagged) for {@code key} within {@link #STALE_MAX_MS}, or null. */
    static JsonObject stale(String key, long nowMs) {
        Entry c = entry;
        if (c != null && c.key.equals(key) && nowMs - c.atMs < STALE_MAX_MS) {
            JsonObject copy = c.payload.deepCopy();
            copy.addProperty("stale", true);
            return copy;
        }
        return null;
    }

    /** Persist a successful probe result for {@code key}. */
    static void store(String key, JsonObject payload, long nowMs) {
        entry = new Entry(nowMs, key, payload);
    }

    /** Test-only: drop the cached payload. */
    static void clearForTests() {
        entry = null;
    }

    private static final class Entry {
        final long atMs;
        final String key;
        final JsonObject payload;

        Entry(long atMs, String key, JsonObject payload) {
            this.atMs = atMs;
            this.key = key;
            this.payload = payload;
        }
    }
}
