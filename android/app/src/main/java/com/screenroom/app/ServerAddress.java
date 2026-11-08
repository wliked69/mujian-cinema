package com.screenroom.app;

import java.net.URI;
import java.net.InetAddress;
import java.net.URISyntaxException;
import java.util.Locale;

/** No network/DNS calls: validates the server the user explicitly chose. */
public final class ServerAddress {
    private final URI base;

    private ServerAddress(URI base) { this.base = base; }

    public static ServerAddress parse(String input) {
        try {
            if (input == null || input.trim().isEmpty()) throw invalid("请填写片库服务器地址。");
            URI uri = new URI(input.trim());
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost();
            if (!(scheme.equals("http") || scheme.equals("https")) || host == null)
                throw invalid("地址需以 http:// 或 https:// 开头，并包含有效主机名。");
            if (uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null)
                throw invalid("地址不能包含账号、密码、查询参数或 # 后缀。");
            if (uri.getRawPath() != null && !uri.getRawPath().isEmpty() && !uri.getRawPath().equals("/"))
                throw invalid("请填写服务器根地址，不要附加页面路径。");
            if (uri.getPort() == 0 || uri.getPort() > 65535 || uri.getRawAuthority().endsWith(":"))
                throw invalid("端口需为 1–65535。");
            host = host.toLowerCase(Locale.ROOT);
            if (scheme.equals("http") && !isLocalHost(host))
                throw invalid("公网服务器请使用 HTTPS；HTTP 仅用于可信局域网。");
            int port = effectivePort(uri);
            String authorityHost = host.contains(":") && !host.startsWith("[") ? "[" + host + "]" : host;
            String portPart = port == (scheme.equals("https") ? 443 : 80) ? "" : ":" + port;
            return new ServerAddress(new URI(scheme + "://" + authorityHost + portPart + "/"));
        } catch (URISyntaxException e) {
            throw invalid("服务器地址格式不正确，请检查空格、主机名和端口。");
        }
    }

    public String url() { return base.toString(); }
    public String displayHost() { return base.getRawAuthority(); }
    public boolean isCleartext() { return base.getScheme().equals("http"); }
    public boolean isLoopback() {
        String host = base.getHost();
        return host.equals("localhost") || ipv6Loopback(host) || host.startsWith("127.");
    }
    public boolean contains(String address) {
        if (address == null) return false;
        try {
            URI target = new URI(address);
            return target.getRawUserInfo() == null && target.getHost() != null
                    && base.getScheme().equalsIgnoreCase(target.getScheme())
                    && hostKey(base.getHost()).equals(hostKey(target.getHost()))
                    && effectivePort(base) == effectivePort(target);
        } catch (URISyntaxException e) { return false; }
    }
    static boolean isExternalWebLink(String value) {
        try {
            URI uri = new URI(value);
            return ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()))
                    && uri.getHost() != null && uri.getRawUserInfo() == null;
        } catch (URISyntaxException | NullPointerException e) { return false; }
    }
    private static int effectivePort(URI uri) {
        return uri.getPort() == -1 ? ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80) : uri.getPort();
    }
    private static boolean isLocalHost(String host) {
        if (host.equals("localhost") || ipv6Loopback(host)) return true;
        if (host.startsWith("[")) {
            String ipv6 = host.substring(1, host.length() - 1);
            return ipv6.matches("(?i)(fc|fd)[0-9a-f]{2}:[0-9a-f:]+")
                    || ipv6.matches("(?i)fe[89ab][0-9a-f]:[0-9a-f:]+");
        }
        if (host.matches("[0-9.]+")) {
            String[] parts = host.split("\\.", -1);
            if (parts.length != 4) return false;
            int[] ip = new int[4];
            for (int i = 0; i < 4; i++) {
                if (!parts[i].matches("0|[1-9][0-9]{0,2}")) return false;
                ip[i] = Integer.parseInt(parts[i]);
                if (ip[i] > 255) return false;
            }
            return ip[0] == 10 || ip[0] == 127 || (ip[0] == 192 && ip[1] == 168)
                    || (ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31)
                    || (ip[0] == 169 && ip[1] == 254);
        }
        return host.matches("[a-z][a-z0-9-]{0,62}")
                || host.matches("[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.local");
    }
    // These branches only parse validated numeric IPv6 literals, never DNS hostnames.
    private static String hostKey(String host) {
        String lower = host.toLowerCase(Locale.ROOT);
        if (lower.startsWith("[") && lower.endsWith("]") && !lower.contains("%")) {
            try { return "[" + InetAddress.getByName(lower.substring(1, lower.length() - 1)).getHostAddress() + "]"; }
            catch (Exception ignored) { return lower; }
        }
        return lower;
    }
    private static boolean ipv6Loopback(String host) {
        if (!host.startsWith("[") || !host.endsWith("]") || host.contains("%")) return false;
        try { return InetAddress.getByName(host.substring(1, host.length() - 1)).isLoopbackAddress(); }
        catch (Exception ignored) { return false; }
    }
    private static IllegalArgumentException invalid(String message) { return new IllegalArgumentException(message); }
}
