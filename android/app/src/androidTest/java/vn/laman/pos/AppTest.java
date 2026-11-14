package vn.laman.pos;

import android.content.Context;
import android.util.Base64;
import android.util.Log;

import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

/** Runs on an Android 6 (API 23) emulator in CI — same Android version as the SUNMI T1. */
@RunWith(AndroidJUnit4.class)
public class AppTest {
    private static final String TAG = "LamAnTest";

    private static Context ctx() {
        return ApplicationProvider.getApplicationContext();
    }

    private static String js(ActivityScenario<MainActivity> sc, String script) throws Exception {
        final String[] out = {null};
        final CountDownLatch done = new CountDownLatch(1);
        sc.onActivity(a -> a.getWebView().evaluateJavascript(script, v -> {
            out[0] = v;
            done.countDown();
        }));
        done.await(15, TimeUnit.SECONDS);
        return out[0];
    }

    /** The bug report: "network error" on Android 6 because Let's Encrypt roots are not trusted. */
    @Test
    public void fullWebAppLoadsOverHttpsOnAndroid6() throws Exception {
        try (ActivityScenario<MainActivity> sc = ActivityScenario.launch(MainActivity.class)) {
            String state = null;
            for (int i = 0; i < 90; i++) {
                state = js(sc, "(function(){return JSON.stringify({title:document.title,url:location.href,login:!!document.querySelector('#cloud-login'),app:!!document.querySelector('#app'),text:(document.body&&document.body.innerText||'').slice(0,160),ua:navigator.userAgent,bridge:typeof window.LamAnAndroid})})()");
                if (state != null && state.contains("\\\"login\\\":true")) break;
                Thread.sleep(1000);
            }
            Log.i(TAG, "page state: " + state);
            JSONObject o = new JSONObject(new JSONArray("[" + state + "]").getString(0));
            Log.i(TAG, "webview UA: " + o.optString("ua"));
            assertTrue("Full web app did not render the login form: " + o, o.optBoolean("login"));
            assertEquals("Lam An · Quầy bán hàng", o.optString("title"));
            assertTrue(o.optString("ua").contains("LamAnPOS/"));
            assertEquals("object", o.optString("bridge"));
            String info = js(sc, "LamAnAndroid.info()");
            Log.i(TAG, "bridge info: " + info);
            assertTrue(info.contains("lam-an-pos"));
        }
    }

    @Test
    public void bundledIsrgRootsValidateVercelChain() throws Exception {
        String sha = TlsCompat.verifiedLeafSha256(ctx(), "orderbaobao.vercel.app");
        Log.i(TAG, "orderbaobao.vercel.app leaf sha256 " + sha);
        assertEquals(64, sha.length());
    }

    @Test
    public void invalidCertificatesAreStillRejected() {
        for (String host : new String[]{"untrusted-root.badssl.com", "expired.badssl.com", "wrong.host.badssl.com", "self-signed.badssl.com"}) {
            try {
                TlsCompat.verifiedLeafSha256(ctx(), host);
                fail("Accepted invalid certificate for " + host);
            } catch (Exception expected) {
                Log.i(TAG, host + " rejected: " + expected.getClass().getSimpleName());
            }
        }
    }

    @Test
    public void printerBridgeWithoutSunmiPrinterFailsGracefully() throws Exception {
        PrinterBridge bridge = new PrinterBridge(ctx());
        JSONObject info = new JSONObject(bridge.info());
        Log.i(TAG, "info on emulator: " + info);
        assertEquals("lam-an-pos", info.getString("app"));
        assertEquals("none", info.getString("printer"));
        JSONObject r = new JSONObject(bridge.printBase64(Base64.encodeToString(new byte[]{0x1b, 0x40}, Base64.NO_WRAP)));
        assertFalse(r.getBoolean("ok"));
        assertTrue(r.getString("message"), r.getString("message").contains("Không tìm thấy máy in"));
        assertFalse(new JSONObject(bridge.printBase64("%%%not-base64")).getBoolean("ok"));
    }

    private static int indexOf(byte[] data, byte[] needle, int from) {
        outer:
        for (int i = from; i <= data.length - needle.length; i++) {
            for (int j = 0; j < needle.length; j++) if (data[i + j] != needle[j]) continue outer;
            return i;
        }
        return -1;
    }

    @Test
    public void receiptRendererProducesEscPosRasterFor58And80mm() throws Exception {
        for (int paper : new int[]{58, 80}) {
            int chars = paper == 80 ? 48 : 32, bytesPerRow = paper == 80 ? 72 : 48;
            StringBuilder ruler = new StringBuilder();
            for (int i = 1; i <= chars; i++) ruler.append(i % 10);
            JSONArray page = new JSONArray()
                    .put(new JSONArray().put("HÓA ĐƠN THANH TOÁN").put(1).put(1))
                    .put(new JSONArray().put("Cà phê sữa đá, Trà đào, Sinh tố").put(0).put(0))
                    .put(new JSONArray().put(ruler.toString()).put(0).put(0))
                    .put(new JSONArray().put("TỔNG CỘNG 79.000đ").put(1).put(2));
            JSONArray pages = new JSONArray().put(page).put(page);
            byte[] out = ReceiptRenderer.render(pages.toString(), paper);
            assertEquals(0x1b, out[0]);
            assertEquals(0x40, out[1]);
            int raster = indexOf(out, new byte[]{0x1d, 0x76, 0x30, 0x00, (byte) bytesPerRow, 0}, 0);
            assertTrue("raster header for " + paper + "mm", raster >= 0);
            byte[] cut = {0x1b, 0x64, 4, 0x1d, 0x56, 0x42, 0x00};
            int first = indexOf(out, cut, 0);
            assertTrue("cut after first copy", first > raster);
            assertTrue("second copy", indexOf(out, cut, first + 1) > first);
            assertEquals(paper == 80 ? 576 : 384, ReceiptRenderer.draw(page, paper).getWidth());
            int black = 0;
            for (int i = raster + 8; i < raster + 8 + bytesPerRow * 40 && i < out.length; i++) if (out[i] != 0) black++;
            assertTrue("text drawn", black > 20);
            Log.i(TAG, paper + "mm receipt: " + out.length + " bytes");
        }
    }

    @Test
    public void printLinksAreHandledInsideTheApp() throws Exception {
        try (ActivityScenario<MainActivity> sc = ActivityScenario.launch(MainActivity.class)) {
            final boolean[] handled = new boolean[4];
            String data = Base64.encodeToString("[[[\"Lam An\",1,0]]]".getBytes("UTF-8"), Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
            sc.onActivity(a -> {
                handled[0] = a.handleUrl("lamanpos://print-lines?paper=58&data=" + data);
                handled[1] = a.handleUrl("intent:base64,G0A=#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;");
                handled[2] = !a.handleUrl("https://orderbaobao.vercel.app/lite");
                handled[3] = a.handleUrl("lamanpos://unknown");
            });
            for (boolean h : handled) assertTrue(h);
            Thread.sleep(3000); // background print threads finish without crashing the app
            sc.onActivity(a -> assertFalse(a.isFinishing()));
        }
    }
}
