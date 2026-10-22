package io.xiangqifriends.app;

public final class ServerAddressTest {
    private static int checks;

    private static void accepted(String input, boolean debug, String expected) {
        String actual = ServerAddress.normalize(input, debug);
        if (!expected.equals(actual)) throw new AssertionError(input + " => " + actual);
        checks++;
    }

    private static void rejected(String input, boolean debug) {
        try {
            ServerAddress.normalize(input, debug);
            throw new AssertionError("Unexpectedly accepted: " + input);
        } catch (IllegalArgumentException expected) { checks++; }
    }

    public static void main(String[] args) {
        accepted(" HTTPS://Example.COM ", false, "https://example.com/");
        accepted("https://example.com:8443/", false, "https://example.com:8443/");
        accepted("https://[::1]/", false, "https://[::1]/");
        accepted("http://localhost:3000/", true, "http://localhost:3000/");
        accepted("http://10.0.2.2:3000/", true, "http://10.0.2.2:3000/");
        for (String invalid : new String[] {
            "", "example.com", "//example.com", "file:///etc/passwd", "content://private/",
            "javascript:alert(1)", "intent://example.com", "http://example.com/",
            "http://localhost.evil.com/", "http://127.0.0.1/", "http://10.0.2.2.evil.com/",
            "https://example.com@evil.com/", "https://user:pass@example.com/",
            "https://example.com/#token", "https://example.com/?token=x", "https://example.com/game",
            "https://example.com/%2f", "https://example.com:0/", "https://example.com:65536/",
            "https://example.com\\@evil.com/", "https://example.com\n.evil.com/"
        }) rejected(invalid, true);
        rejected("http://localhost:3000/", false);
        rejected("http://10.0.2.2:3000/", false);
        System.out.println("Server address checks passed: " + checks);
    }
}
