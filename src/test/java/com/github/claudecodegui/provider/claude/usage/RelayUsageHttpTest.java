package com.github.claudecodegui.provider.claude.usage;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

public class RelayUsageHttpTest {

    @Test
    public void secureOrigin_httpsOriginKeptPortAndPathDropped() {
        assertEquals("https://api.z.ai", RelayUsageHttp.secureOrigin("https://api.z.ai/api/anthropic"));
        assertEquals("https://proxy.corp:8443", RelayUsageHttp.secureOrigin("https://proxy.corp:8443/anthropic"));
    }

    @Test
    public void secureOrigin_plainHttpOnlyForLoopback() {
        assertEquals("http://localhost:8080", RelayUsageHttp.secureOrigin("http://localhost:8080/api"));
        assertEquals("http://127.0.0.1:9000", RelayUsageHttp.secureOrigin("http://127.0.0.1:9000/api"));
        // Credentials must not travel over plaintext to a remote host
        assertNull(RelayUsageHttp.secureOrigin("http://api.z.ai/api/anthropic"));
        assertNull(RelayUsageHttp.secureOrigin("http://evil.com"));
    }

    @Test
    public void secureOrigin_malformedYieldsNull() {
        assertNull(RelayUsageHttp.secureOrigin(null));
        assertNull(RelayUsageHttp.secureOrigin("not a url"));
        assertNull(RelayUsageHttp.secureOrigin("api.z.ai")); // no scheme
    }
}
