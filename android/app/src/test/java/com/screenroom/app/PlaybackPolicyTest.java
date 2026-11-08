package com.screenroom.app;
import org.junit.Test;
import static org.junit.Assert.*;

public class PlaybackPolicyTest {
    private final ServerAddress server = ServerAddress.parse("http://192.168.1.20:3210");
    private final String ticket = "a".repeat(43);
    @Test public void prefersTicketMimeWithoutFilename() {
        assertEquals("video/mp4", PlaybackPolicy.videoMime(server.url()+"play/"+ticket, " Video/MP4 "));
        assertEquals("video/x-matroska", PlaybackPolicy.videoMime(server.url()+"play/"+ticket, "video/x-matroska"));
    }
    @Test public void derivesOnlyAllowedVideoTypesFromActualPath() {
        assertEquals("video/webm", PlaybackPolicy.videoMime("https://example.test/a.WEBM?path=abc.mp4", "text/html"));
        assertEquals("application/vnd.apple.mpegurl", PlaybackPolicy.videoMime("https://example.test/a.m3u8", ""));
        assertEquals("video/*", PlaybackPolicy.videoMime("https://example.test/opaque?path=abc.mp4", "image/png"));
        assertEquals("video/*", PlaybackPolicy.videoMime(server.url()+"play/"+ticket, "video/mp4; arbitrary=true"));
        assertEquals("video/*", PlaybackPolicy.videoMime(null, null));
    }
    @Test public void acceptsOnlyScopedTicketOnCurrentServer() {
        assertTrue(PlaybackPolicy.allowed(server, server.url()+"play/"+ticket));
        for(String path : new String[]{"api/library","api/admin/users","media/movie/video","play/short","play/"+ticket+"?secret=x","play/"+ticket+"#secret"}) assertFalse(PlaybackPolicy.allowed(server,server.url()+path));
    }
    @Test public void acceptsAuthorizedDirectHttpsOrPrivateApiMedia() {
        assertTrue(PlaybackPolicy.allowed(server,"https://media.example.com/video.mp4?signature=authorized-link"));
        assertTrue(PlaybackPolicy.allowed(server,"http://192.168.1.30:8080/video.mkv"));
        assertFalse(PlaybackPolicy.allowed(server,"http://public.example.com/video.mp4"));
    }
    @Test public void rejectsDangerousSchemesAndCredentials() {
        for(String url : new String[]{"file:///storage/video.mp4","content://video/1","intent://video","javascript:alert(1)","https://admin:pass@media.example.com/a.mp4",null,"bad"}) assertFalse(PlaybackPolicy.allowed(server,url));
    }
    @Test public void acceptsIpv6ScopedVideoTicket() {
        ServerAddress ipv6 = ServerAddress.parse("http://[fd12::10]:3210");
        assertTrue(PlaybackPolicy.allowed(ipv6,ipv6.url()+"play/"+ticket));
        assertFalse(PlaybackPolicy.allowed(ipv6,ipv6.url()+"api/auth/me"));
    }
}
