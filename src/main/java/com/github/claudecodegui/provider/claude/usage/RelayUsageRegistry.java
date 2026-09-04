package com.github.claudecodegui.provider.claude.usage;

import com.github.claudecodegui.settings.CodemossSettingsService;
import com.google.gson.JsonObject;
import com.intellij.openapi.diagnostic.Logger;

import java.net.URI;
import java.util.List;
import java.util.Locale;

/**
 * Resolves the plan-usage payload for the active relay backend: matches
 * {@code ANTHROPIC_BASE_URL} against the registered {@link RelayUsageVendor}s,
 * then probes with the shared cache/stale policy.
 *
 * <p>Registration order matters where vendors share a host:
 * {@code api.kimi.com} serves both the plain Moonshot API and the Coding Plan,
 * so {@code kimi-coding} (path-gated on {@code /coding}) must sit before any
 * future plain-kimi/moonshot vendor.
 */
public final class RelayUsageRegistry {

    private static final Logger LOG = Logger.getInstance(RelayUsageRegistry.class);

    private static final List<RelayUsageVendor> VENDORS = List.of(
            new KimiCodingUsageVendor(),
            new MiniMaxUsageVendor(),
            new ZaiUsageVendor());

    private RelayUsageRegistry() {
    }

    /**
     * Resolve the capacity payload for the relay backend described by
     * {@code settings} (the Claude settings object; see
     * {@link CodemossSettingsService#readClaudeSettings()}). Null when no
     * vendor matches, the credential is missing, the probe yields no usable
     * data and no fresh/stale cache entry can be served — callers fall back to
     * the SDK rate_limit snapshot.
     */
    public static JsonObject resolve(JsonObject settings, long nowMs) {
        RelayUsageEnv env = RelayUsageEnv.from(settings);
        RelayUsageVendor vendor = match(env.baseUrl());
        if (vendor == null || env.token() == null) {
            return null;
        }
        // Key the cache by vendor + endpoint + credential so an account/base-URL
        // switch never serves the previous account's quota.
        String cacheKey = vendor.id() + '\n' + env.baseUrl() + '\n' + env.token();

        JsonObject fresh = RelayUsageCache.fresh(cacheKey, nowMs);
        if (fresh != null) {
            return fresh;
        }
        try {
            JsonObject payload = vendor.probe(env);
            if (payload != null) {
                RelayUsageCache.store(cacheKey, payload, nowMs);
                return payload.deepCopy();
            }
        } catch (Exception e) {
            LOG.warn("relay usage probe failed (" + vendor.id() + "): " + e.getMessage());
        }
        return RelayUsageCache.stale(cacheKey, nowMs);
    }

    /** Vendor owning {@code baseUrl}, or null when unassigned/malformed. */
    static RelayUsageVendor match(String baseUrl) {
        if (baseUrl == null) {
            return null;
        }
        String host;
        String path;
        try {
            URI u = URI.create(baseUrl);
            if (u.getHost() == null) {
                return null;
            }
            host = u.getHost().toLowerCase(Locale.ROOT);
            path = u.getPath() == null ? "" : u.getPath().toLowerCase(Locale.ROOT);
        } catch (Exception e) {
            return null;
        }
        for (RelayUsageVendor vendor : VENDORS) {
            if (vendor.matches(host, path)) {
                return vendor;
            }
        }
        return null;
    }

    /** Registered vendors, in match order (tests). */
    static List<RelayUsageVendor> vendors() {
        return VENDORS;
    }
}
