package com.screenroom.app;

/** Discovery is a hint, not server authentication. Never trust a packet's advertised URL. */
public final class DiscoveryRules {
    public static final int PORT = 43210;
    private DiscoveryRules() {}
    public static boolean privateIpv4(String address) {
        if (address == null) return false;
        String[] parts = address.split("\\.", -1);
        if (parts.length != 4) return false;
        int[] n = new int[4];
        for (int i = 0; i < 4; i++) {
            if (!parts[i].matches("0|[1-9][0-9]{0,2}")) return false;
            n[i] = Integer.parseInt(parts[i]);
            if (n[i] > 255) return false;
        }
        return n[0] == 10 || n[0] == 192 && n[1] == 168 || n[0] == 172 && n[1] >= 16 && n[1] <= 31 || n[0] == 169 && n[1] == 254;
    }
    public static String candidate(String source, int port, String kind, int version, String nonce, String expected) {
        if (!privateIpv4(source) || port < 1 || port > 65535 || !"screenroom-server".equals(kind) || version != 1
                || expected == null || !expected.matches("[a-f0-9]{32}") || !expected.equals(nonce)) return null;
        return ServerAddress.parse("http://" + source + ":" + port).url();
    }
}
