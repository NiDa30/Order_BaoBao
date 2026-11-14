package vn.laman.pos;

import android.content.Context;
import android.net.http.SslCertificate;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;

import java.io.InputStream;
import java.net.URL;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.cert.Certificate;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

/**
 * Android older than 7.1.1 (e.g. SUNMI T1 on Android 6) does not trust Let's Encrypt's ISRG roots, which
 * Vercel certificates chain to. WebView then reports SSL_UNTRUSTED. This class re-validates the server
 * chain with the system roots plus the bundled ISRG Root X1/X2 (full PKIX path validation and hostname
 * check) and only accepts the error when WebView saw exactly the same leaf certificate.
 */
public final class TlsCompat {
    private static volatile SSLContext context;
    private static final Map<String, String> trusted = new ConcurrentHashMap<>();

    private TlsCompat() {
    }

    static synchronized SSLContext sslContext(Context ctx) throws Exception {
        if (context != null) return context;
        CertificateFactory cf = CertificateFactory.getInstance("X.509");
        KeyStore extra = KeyStore.getInstance(KeyStore.getDefaultType());
        extra.load(null, null);
        int[] roots = {R.raw.isrg_root_x1, R.raw.isrg_root_x2};
        for (int i = 0; i < roots.length; i++) {
            try (InputStream in = ctx.getResources().openRawResource(roots[i])) {
                extra.setCertificateEntry("isrg" + i, cf.generateCertificate(in));
            }
        }
        final X509TrustManager system = trustManager(null), bundled = trustManager(extra);
        X509TrustManager combined = new X509TrustManager() {
            @Override
            public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                system.checkClientTrusted(chain, authType);
            }

            @Override
            public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                try {
                    system.checkServerTrusted(chain, authType);
                } catch (CertificateException e) {
                    bundled.checkServerTrusted(chain, authType); // ISRG roots missing from old Android
                }
            }

            @Override
            public X509Certificate[] getAcceptedIssuers() {
                X509Certificate[] a = system.getAcceptedIssuers(), b = bundled.getAcceptedIssuers();
                X509Certificate[] all = Arrays.copyOf(a, a.length + b.length);
                System.arraycopy(b, 0, all, a.length, b.length);
                return all;
            }
        };
        SSLContext c = SSLContext.getInstance("TLS");
        c.init(null, new TrustManager[]{combined}, null);
        context = c;
        return c;
    }

    private static X509TrustManager trustManager(KeyStore ks) throws Exception {
        TrustManagerFactory f = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        f.init(ks);
        for (TrustManager t : f.getTrustManagers()) if (t instanceof X509TrustManager) return (X509TrustManager) t;
        throw new IllegalStateException("No X509TrustManager");
    }

    static String sha256(byte[] der) throws Exception {
        byte[] d = MessageDigest.getInstance("SHA-256").digest(der);
        StringBuilder sb = new StringBuilder();
        for (byte b : d) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    /** DER bytes of the leaf certificate WebView received, or null if not available. */
    static byte[] leafDer(SslCertificate cert) {
        if (cert == null) return null;
        try {
            if (Build.VERSION.SDK_INT >= 29 && cert.getX509Certificate() != null) return cert.getX509Certificate().getEncoded();
            Bundle b = SslCertificate.saveState(cert);
            return b == null ? null : b.getByteArray("x509-certificate");
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Connects to https://host/ with the extended trust store and returns the SHA-256 of the server's
     * leaf certificate if the chain and hostname are valid; throws otherwise. Runs network I/O: call off the UI thread.
     */
    public static String verifiedLeafSha256(Context ctx, String host) throws Exception {
        HttpsURLConnection c = (HttpsURLConnection) new URL("https://" + host + "/").openConnection();
        try {
            c.setSSLSocketFactory(sslContext(ctx).getSocketFactory());
            c.setConnectTimeout(15000);
            c.setReadTimeout(15000);
            c.setRequestMethod("HEAD");
            c.setInstanceFollowRedirects(false);
            c.connect(); // default HostnameVerifier checks the host name
            Certificate[] chain = c.getServerCertificates();
            return sha256(chain[0].getEncoded());
        } finally {
            c.disconnect();
        }
    }

    /** True if this SSL error is an untrusted-root error for a certificate we validated ourselves. */
    public static boolean accept(Context ctx, SslError error) {
        if (error == null || error.getPrimaryError() != SslError.SSL_UNTRUSTED) return false;
        if (error.hasError(SslError.SSL_EXPIRED) || error.hasError(SslError.SSL_IDMISMATCH) || error.hasError(SslError.SSL_NOTYETVALID)
                || error.hasError(SslError.SSL_DATE_INVALID) || error.hasError(SslError.SSL_INVALID)) return false;
        try {
            String host = new URL(error.getUrl()).getHost();
            byte[] der = leafDer(error.getCertificate());
            if (host == null || host.isEmpty() || der == null) return false;
            String seen = sha256(der);
            if (seen.equals(trusted.get(host))) return true;
            String verified = verifiedLeafSha256(ctx, host);
            if (!verified.equals(seen)) return false; // WebView got a different certificate: refuse
            trusted.put(host, verified);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
