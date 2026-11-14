package vn.laman.pos;

import android.content.Context;
import android.util.Base64;
import android.util.Log;

import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

/** Runs on an Android 6 (API 23) emulator in CI — same Android version as the SUNMI T1. */
@RunWith(AndroidJUnit4.class)
public class AppTest {
    private static final String TAG = "LamAnTest";

    private static Context ctx() {
        return ApplicationProvider.getApplicationContext();
    }

    /**
     * The bug report: "network error" on Android 6 (Let's Encrypt roots not trusted, WebView too old).
     * With GeckoView the full web app must load over HTTPS, render, and see window.LamAnAndroid.
     */
    @Test
    public void fullWebAppLoadsOverHttpsWithPrinterBridgeOnAndroid6() throws Exception {
        MainActivity.lastPageState = null;
        try (ActivityScenario<MainActivity> sc = ActivityScenario.launch(MainActivity.class)) {
            String state = null;
            for (int i = 0; i < 150; i++) {
                state = MainActivity.lastPageState;
                if (state != null && state.contains("\"login\":true")) break;
                Thread.sleep(1000);
            }
            Log.i(TAG, "page state: " + state);
            assertNotNull("The page never reported its state (extension not injected or page did not load)", state);
            JSONObject o = new JSONObject(state);
            assertTrue("Full web app did not render the login form: " + o, o.optBoolean("login"));
            assertEquals("Lam An · Quầy bán hàng", o.optString("title"));
            assertTrue(o.optString("url").startsWith("https://orderbaobao.vercel.app/"));
            assertEquals("window.LamAnAndroid visible to the page", "function", o.optString("bridge"));
        }
    }

    /**
     * DNS fallback. In CI this also runs on an emulator whose DNS server is unreachable (brokenDns=true):
     * the device resolver must fail there while DNS over HTTPS (used by GeckoView first) still works.
     */
    @Test
    public void dnsOverHttpsResolvesTheShopSite() {
        String diag = MainActivity.diagnose("orderbaobao.vercel.app");
        Log.i(TAG, "dns diagnosis: " + diag.replace("\n", " | "));
        assertTrue(diag, diag.contains("DNS qua HTTPS (1.1.1.1): được"));
        if ("true".equals(InstrumentationRegistry.getArguments().getString("brokenDns"))) {
            assertTrue("device DNS should be broken in this run: " + diag, diag.contains("DNS của máy: không phân giải được"));
        }
    }

    @Test
    public void bridgeAnswersOnlyTheShopSite() throws Exception {
        try (ActivityScenario<MainActivity> sc = ActivityScenario.launch(MainActivity.class)) {
            final String[] r = new String[3];
            sc.onActivity(a -> {
                r[0] = a.answer("info", "", "https://orderbaobao.vercel.app/");
                r[1] = a.answer("printBase64", "G0A=", "https://evil.example/");
                r[2] = a.answer("info", "", "http://orderbaobao.vercel.app/");
            });
            Thread.sleep(100);
            Log.i(TAG, "info via bridge: " + r[0]);
            JSONObject info = new JSONObject(r[0]);
            assertEquals("lam-an-pos", info.getString("app"));
            assertEquals("gecko", info.getString("engine"));
            assertEquals("none", info.getString("printer")); // emulator has no SUNMI printer
            assertFalse(new JSONObject(r[1]).getBoolean("ok"));
            assertFalse(new JSONObject(r[2]).getBoolean("ok"));
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
            final boolean[] handled = new boolean[5];
            String data = Base64.encodeToString("[[[\"Lam An\",1,0]]]".getBytes("UTF-8"), Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
            sc.onActivity(a -> {
                handled[0] = a.handleUrl("lamanpos://print-lines?paper=58&data=" + data);
                handled[1] = a.handleUrl("intent:base64,G0A=#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;");
                handled[2] = !a.handleUrl("https://orderbaobao.vercel.app/lite");
                handled[3] = !a.handleUrl("https://abc.supabase.co/rest/v1/rpc/x");
                handled[4] = a.handleUrl("lamanpos://unknown");
            });
            for (boolean h : handled) assertTrue(h);
            Thread.sleep(3000); // background print threads finish without crashing the app
            sc.onActivity(a -> assertFalse(a.isFinishing()));
        }
    }
}
