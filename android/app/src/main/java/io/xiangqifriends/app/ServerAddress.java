package io.xiangqifriends.app;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** Validates the entire authority rather than trusting host suffixes or URL prefixes. */
public final class ServerAddress {
    private ServerAddress() {}

    public static String normalize(String raw, boolean debug) {
        try {
            URI uri = new URI(raw.trim());
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            boolean localHttp = debug && scheme.equals("http")
                && (host.equals("localhost") || host.equals("10.0.2.2"));
            if (!(scheme.equals("https") || localHttp) || host.isEmpty()
                || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                || (uri.getRawPath() != null && !uri.getRawPath().isEmpty() && !uri.getRawPath().equals("/"))
                || uri.getPort() == 0 || uri.getPort() > 65535) {
                throw new IllegalArgumentException("请填写有效的 HTTPS 站点根地址，例如 https://example.com/。");
            }
            return new URI(scheme, null, host, uri.getPort(), "/", null, null).toASCIIString();
        } catch (URISyntaxException exception) {
            throw new IllegalArgumentException("地址格式不正确，请使用完整的 HTTPS 网址。");
        }
    }
}
