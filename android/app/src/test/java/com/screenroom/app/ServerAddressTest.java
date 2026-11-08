package com.screenroom.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class ServerAddressTest {
    @Test public void equivalentIpv6OriginsMatchForMobileBridge() {
        ServerAddress expanded = ServerAddress.parse("http://[fd12:0:0:0:0:0:0:10]:3210");
        assertTrue(expanded.contains("http://[fd12::10]:3210/play/clip"));
        assertFalse(expanded.contains("http://[fd12::11]:3210/play/clip"));
        assertTrue(ServerAddress.parse("http://[0:0:0:0:0:0:0:1]:3210").isLoopback());
    }
    private void rejects(String value) {
        assertThrows("should reject: " + value, IllegalArgumentException.class, () -> ServerAddress.parse(value));
    }
    @Test public void normalizesAddressAndDefaultPorts() {
        assertEquals("http://192.168.1.10:3210/", ServerAddress.parse("  HTTP://192.168.1.10:3210  ").url());
        assertEquals("https://example.com/", ServerAddress.parse("HTTPS://EXAMPLE.COM:443/").url());
        assertEquals("http://nas.local/", ServerAddress.parse("http://NAS.local:80").url());
    }
    @Test public void acceptsPrivateIpv4AndLocalNames() {
        for (String host : new String[]{"10.0.2.2", "172.16.0.1", "172.31.255.254", "192.168.1.1", "169.254.1.1", "127.0.0.1", "nas", "server-1", "nas.local", "movies.nas.local"})
            assertNotNull(ServerAddress.parse("http://" + host + ":3210"));
    }
    @Test public void acceptsPrivateIpv6() {
        for (String host : new String[]{"[::1]", "[fd12::1]", "[fc00:1234::1]", "[fe80::1]"})
            assertNotNull(ServerAddress.parse("http://" + host + ":3210"));
    }
    @Test public void rejectsPublicHttp() {
        for (String host : new String[]{"example.com", "8.8.8.8", "172.15.255.255", "172.32.0.1", "192.169.1.1", "0.0.0.0", "[2001:db8::1]"}) rejects("http://" + host);
    }
    @Test public void rejectsAmbiguousOrInvalidNumericHosts() {
        for (String host : new String[]{"127.1", "2130706433", "0177.0.0.1", "192.168.1.256", "192.168..1"}) rejects("http://" + host);
    }
    @Test public void rejectsCredentialsPathsQueriesFragmentsAndPorts() {
        for (String value : new String[]{"http://admin:pass@nas", "http://nas/login", "http://nas/%2f", "http://nas?x=1", "http://nas/#token", "http://nas:0", "http://nas:65536", "http://nas:", "http://nas:-1"}) rejects(value);
    }
    @Test public void rejectsUnsafeAndMalformedSchemes() {
        for (String value : new String[]{null, "", "192.168.1.10:3210", "file:///storage/movie", "javascript:alert(1)", "intent://nas", "content://nas", "http://", "http://my nas.local"}) rejects(value);
    }
    @Test public void recognizesOnlyExactSameOrigin() {
        ServerAddress server = ServerAddress.parse("http://nas.local:3210");
        assertTrue(server.contains("http://NAS.local:3210/random?genre=drama#test"));
        for (String value : new String[]{"http://nas.local:3211/", "https://nas.local:3210/", "http://nas.local.evil:3210/", "http://user@nas.local:3210/", "javascript:alert(1)", null, "/random"}) assertFalse(server.contains(value));
        assertTrue(ServerAddress.parse("https://example.com").contains("https://example.com:443/movie"));
    }
    @Test public void marksPhoneLoopback() {
        assertTrue(ServerAddress.parse("http://localhost:3210").isLoopback());
        assertTrue(ServerAddress.parse("http://127.0.0.1:3210").isLoopback());
        assertTrue(ServerAddress.parse("http://[::1]:3210").isLoopback());
        assertFalse(ServerAddress.parse("http://192.168.1.10:3210").isLoopback());
    }
    @Test public void externalLinksNeverContainCredentialsOrUnsafeSchemes() {
        assertTrue(ServerAddress.isExternalWebLink("https://example.com/docs"));
        assertFalse(ServerAddress.isExternalWebLink("https://user:pass@example.com"));
        assertFalse(ServerAddress.isExternalWebLink("file:///private"));
        assertFalse(ServerAddress.isExternalWebLink("intent://example.com"));
    }
}
