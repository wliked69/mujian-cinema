package com.screenroom.app;
import org.junit.Test;
import static org.junit.Assert.*;

public class DiscoveryRulesTest {
    private final String nonce = "0123456789abcdef0123456789abcdef";
    @Test public void privateNetworksOnly() {
        for (String ip : new String[]{"192.168.1.2", "10.2.3.4", "172.16.0.2", "172.31.255.254", "169.254.2.3"}) assertTrue(DiscoveryRules.privateIpv4(ip));
        for (String ip : new String[]{"8.8.8.8", "127.0.0.1", "172.15.0.2", "172.32.0.2", "192.168.0.256", "192.168..2", "012.1.2.3", null}) assertFalse(DiscoveryRules.privateIpv4(ip));
    }
    @Test public void buildsAddressFromPacketSourceAndPort() {
        assertEquals("http://192.168.1.20:3210/", DiscoveryRules.candidate("192.168.1.20",3210,"screenroom-server",1,nonce,nonce));
    }
    @Test public void rejectsUnknownProtocolAndNonce() {
        assertNull(DiscoveryRules.candidate("192.168.1.20",3210,"another-service",1,nonce,nonce));
        assertNull(DiscoveryRules.candidate("192.168.1.20",3210,"screenroom-server",2,nonce,nonce));
        assertNull(DiscoveryRules.candidate("192.168.1.20",3210,"screenroom-server",1,"bad",nonce));
        assertNull(DiscoveryRules.candidate("192.168.1.20",3210,"screenroom-server",1,nonce,null));
    }
    @Test public void rejectsPublicSourcesAndInvalidPorts() {
        assertNull(DiscoveryRules.candidate("8.8.8.8",3210,"screenroom-server",1,nonce,nonce));
        for (int port : new int[]{-1,0,65536}) assertNull(DiscoveryRules.candidate("192.168.1.20",port,"screenroom-server",1,nonce,nonce));
    }
}
