package com.screenroom.app;

import org.json.JSONObject;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;

/** Bounded LAN UDP discovery, not a subnet/port sweep. No credentials are sent. */
public final class LanDiscovery {
    public interface Listener {
        void found(String address);
        void finished(String message);
    }
    private volatile boolean stopped;
    private volatile DatagramSocket socket;
    public void start(Listener listener) {
        new Thread(() -> search(listener), "screenroom-lan-discovery").start();
    }
    public void stop() { stopped = true; DatagramSocket current = socket; if (current != null) current.close(); }
    private void search(Listener listener) {
        int found = 0;
        try {
            Set<InetAddress> broadcasts = new LinkedHashSet<>();
            for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!network.isUp() || network.isLoopback()) continue;
                for (InterfaceAddress address : network.getInterfaceAddresses()) {
                    if (address.getAddress() instanceof Inet4Address && DiscoveryRules.privateIpv4(address.getAddress().getHostAddress())
                            && address.getBroadcast() != null && broadcasts.size() < 8) broadcasts.add(address.getBroadcast());
                }
            }
            if (broadcasts.isEmpty()) { if (!stopped) listener.finished("未发现可用的 IPv4 局域网，请连接 Wi-Fi，或手动填写 IPv6 / 服务器地址。"); return; }
            byte[] random = new byte[16]; new SecureRandom().nextBytes(random);
            StringBuilder nonce = new StringBuilder();
            for (byte b : random) nonce.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
            byte[] request = ("{\"kind\":\"screenroom-discover\",\"v\":1,\"nonce\":\"" + nonce + "\"}").getBytes(StandardCharsets.UTF_8);
            DatagramSocket current = new DatagramSocket(); socket = current;
            if (stopped) { current.close(); return; }
            current.setBroadcast(true); current.setSoTimeout(400);
            Set<String> seen = new LinkedHashSet<>();
            long started = System.nanoTime(), lastSend = 0;
            while (!stopped && (System.nanoTime() - started) / 1_000_000 < 6500) {
                long elapsed = (System.nanoTime() - started) / 1_000_000;
                if (lastSend == 0 || elapsed >= 2200 && lastSend == 1) {
                    for (InetAddress address : broadcasts) current.send(new DatagramPacket(request, request.length, address, DiscoveryRules.PORT));
                    lastSend++;
                }
                DatagramPacket packet = new DatagramPacket(new byte[1025], 1025);
                try { current.receive(packet); } catch (SocketTimeoutException ignored) { continue; }
                if (packet.getLength() > 1024 || packet.getPort() != DiscoveryRules.PORT) continue;
                try {
                    JSONObject response = new JSONObject(new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8));
                    Object responsePort = response.opt("port");
                    if (!(responsePort instanceof Integer) || !(response.opt("v") instanceof Integer) || !(response.opt("nonce") instanceof String)) continue;
                    String address = DiscoveryRules.candidate(packet.getAddress().getHostAddress(), (Integer) responsePort,
                            response.optString("kind"), response.optInt("v"), response.optString("nonce"), nonce.toString());
                    if (address != null && seen.size() < 20 && seen.add(address)) { found++; if (!stopped) listener.found(address); }
                } catch (Exception ignored) { /* Untrusted LAN data is not an instruction or URL source. */ }
            }
            if (!stopped) listener.finished(found == 0 ? "没有找到片库。请确认电脑已升级、已允许局域网和 App 搜索；访客 Wi-Fi、广播隔离或防火墙可能阻止搜索，可手动填写地址。" : "搜索完成，点击地址填入，再确认连接。发现结果不代表已验证服务器身份。");
        } catch (Exception ignored) {
            if (!stopped) listener.finished("局域网搜索不可用，请检查 Wi-Fi / 系统网络权限，或手动填写服务器地址。");
        } finally { DatagramSocket current = socket; if (current != null) current.close(); socket = null; }
    }
}
