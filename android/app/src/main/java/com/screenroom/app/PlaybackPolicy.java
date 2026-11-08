package com.screenroom.app;

import java.net.URI;
import java.util.Locale;

/** Only network video URLs; never accept file/content/intent or account API URLs. */
public final class PlaybackPolicy {
    private PlaybackPolicy() {}
    static final String GENERIC_VIDEO = "video/*";
    static final String HLS_VIDEO = "application/vnd.apple.mpegurl";

    static String videoMime(String address, String hint) {
        // The server knows the format of NAS playback tickets, whose paths omit filenames.
        String mime = hint == null ? "" : hint.trim().toLowerCase(Locale.ROOT);
        if (mime.matches("video/[a-z0-9][a-z0-9.+-]{0,63}") || mime.equals(HLS_VIDEO)) return mime;
        try {
            String path = URI.create(address).getPath();
            if (path != null) {
                int dot = path.lastIndexOf('.');
                if (dot > path.lastIndexOf('/')) return switch (path.substring(dot + 1).toLowerCase(Locale.ROOT)) {
                    case "mp4", "m4v" -> "video/mp4";
                    case "mkv" -> "video/x-matroska";
                    case "webm" -> "video/webm";
                    case "mov" -> "video/quicktime";
                    case "avi" -> "video/x-msvideo";
                    case "ts" -> "video/mp2t";
                    case "m3u8" -> HLS_VIDEO;
                    default -> GENERIC_VIDEO;
                };
            }
        } catch (IllegalArgumentException | NullPointerException ignored) { /* Use only a safe video type. */ }
        return GENERIC_VIDEO;
    }

    public static boolean allowed(ServerAddress server, String value) {
        if (server == null || value == null || value.length() > 8192) return false;
        try {
            URI uri = new URI(value);
            if (!ServerAddress.isExternalWebLink(value) || uri.getRawFragment() != null) return false;
            if (server.contains(value)) return uri.getRawQuery() == null && uri.getPath().matches("/play/[A-Za-z0-9_-]{43}");
            // Direct API media is allowed only when its root obeys the same HTTPS/private-HTTP policy.
            ServerAddress.parse(uri.getScheme() + "://" + uri.getRawAuthority());
            return true;
        } catch (Exception e) { return false; }
    }
}
