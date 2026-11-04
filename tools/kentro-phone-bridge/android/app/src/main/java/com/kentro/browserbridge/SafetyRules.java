package com.kentro.browserbridge;

import java.net.IDN;
import java.net.URI;
import java.util.Locale;
import java.util.Set;
import java.util.HashSet;

/** Pure Java policy shared by the Android runner and executable desktop tests. */
public final class SafetyRules {
    private SafetyRules() {}
    public static final int MAX_TYPED_CHARS = 2000;
    public static final String BROWSER_PACKAGE = "com.android.chrome";
    public static boolean approvedUrl(String raw, String hostsCsv) {
        if (raw == null || raw.length() > 2048 || raw.indexOf('\n') >= 0 || raw.indexOf('\r') >= 0) return false;
        try {
            URI u = new URI(raw);
            if (!"https".equalsIgnoreCase(u.getScheme()) || u.getRawUserInfo() != null || u.getPort() != -1) return false;
            String hostname = u.getHost();
            if (hostname == null) return false;
            hostname = IDN.toASCII(hostname).toLowerCase(Locale.ROOT);
            Set<String> hosts = new HashSet<>();
            for (String h : hostsCsv.split(",")) {
                String clean = h.trim().toLowerCase(Locale.ROOT);
                if (!clean.isEmpty()) hosts.add(clean);
            }
            return hosts.contains(hostname);
        } catch (Exception e) { return false; }
    }
    public static boolean safeLabel(String label) {
        if (label == null || label.isEmpty() || label.length() > 100) return false;
        String s = label.toLowerCase(Locale.ROOT);
        return !(s.matches("(?s).*(delete|withdraw|transfer|buy now|checkout|purchase|pay now|send money|"
            + "password|two.factor|2fa|recovery code|grant access|allow permissions|publish|deploy|"
            + "sign out|log out|remove account|reset account|secrets|api key).*"));
    }
    public static boolean safeText(String text) {
        return text != null && text.length() <= MAX_TYPED_CHARS && !text.contains("\u0000");
    }
    public static boolean allowedOperation(String op) {
        return Set.of("navigate","read_ui","tap_text","tap_point","type_text","scroll","back","screenshot","status").contains(op);
    }
}