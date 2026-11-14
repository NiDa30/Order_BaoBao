package vn.laman.pos;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.util.Log;
import android.view.KeyEvent;
import android.widget.EditText;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;
import org.mozilla.geckoview.AllowOrDeny;
import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoRuntimeSettings;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoView;
import org.mozilla.geckoview.WebExtension;
import org.mozilla.geckoview.WebRequestError;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.util.Scanner;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Lam An POS for Android POS terminals. Shows the shop's full web app in GeckoView (Firefox engine, bundled
 * with the app) so it also runs on old devices such as the SUNMI T1 (Android 6): the system WebView there
 * is too old for the app and does not trust the Let's Encrypt certificates used by Vercel.
 * Bills print on the built-in SUNMI printer through window.LamAnAndroid (built-in WebExtension,
 * assets/lamanpos) or the RawBT / lamanpos:// links, so RawBT is not needed.
 */
public class MainActivity extends Activity {
    private static final String TAG = "LamAnPOS";
    private static final String PREFS = "lam-an-pos";
    static final String DOH_URL = "https://1.1.1.1/dns-query";
    private static GeckoRuntime runtime;
    /** Last page state reported by the content script (device tests and diagnostics). */
    static volatile String lastPageState = null;

    private GeckoView view;
    private GeckoSession session;
    private SharedPreferences prefs;
    private PrinterBridge printer;
    private boolean canGoBack;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        printer = new PrinterBridge(this);
        printer.connect();

        view = new GeckoView(this);
        setContentView(view);
        if (runtime == null) {
            runtime = GeckoRuntime.create(getApplicationContext(), new GeckoRuntimeSettings.Builder()
                    .javaScriptEnabled(true)
                    .remoteDebuggingEnabled(false)
                    // Some shop networks/ISPs fail to resolve *.vercel.app. Resolve names over HTTPS first
                    // (IP address URL: needs no DNS itself) and fall back to the device DNS if DoH is blocked.
                    .trustedRecursiveResolverMode(GeckoRuntimeSettings.TRR_MODE_FIRST)
                    .trustedRecursiveResolverUri(DOH_URL)
                    .build());
        }
        session = new GeckoSession();
        session.setPromptDelegate(new GeckoPrompts(this));
        session.setNavigationDelegate(new GeckoSession.NavigationDelegate() {
            @Override
            public GeckoResult<AllowOrDeny> onLoadRequest(GeckoSession s, LoadRequest request) {
                return GeckoResult.fromValue(handleUrl(request.uri) ? AllowOrDeny.DENY : AllowOrDeny.ALLOW);
            }

            @Override
            public void onCanGoBack(GeckoSession s, boolean value) {
                canGoBack = value;
            }

            @Override
            public GeckoResult<String> onLoadError(GeckoSession s, String uri, WebRequestError error) {
                // Build the error page with a quick network diagnosis (device DNS, DNS over HTTPS).
                final GeckoResult<String> page = new GeckoResult<>();
                final String host = Uri.parse(uri == null ? startUrl() : uri).getHost();
                final String code = "Mã lỗi " + error.code + " / " + error.category + " · " + errorText(error.code);
                worker.execute(() -> {
                    String diag = diagnose(host == null ? Uri.parse(baseUrl()).getHost() : host);
                    final String html = problemPage("Không kết nối được", "Kiểm tra Wi-Fi hoặc mạng rồi bấm Thử lại.", code + "\n" + diag, startUrl());
                    runOnUiThread(() -> page.complete(html));
                });
                return page;
            }
        });
        session.open(runtime);
        view.setSession(session);

        // Load the page only once the bridge extension is ready, so window.LamAnAndroid exists from the start.
        runtime.getWebExtensionController()
                .ensureBuiltIn("resource://android/assets/lamanpos/", "lamanpos@laman.vn")
                .accept(ext -> {
                    session.getWebExtensionController().setMessageDelegate(ext, messageDelegate, "lamanpos");
                    session.loadUri(startUrl());
                }, e -> {
                    Log.e(TAG, "bridge extension failed", e);
                    session.loadUri(startUrl());
                });
    }

    private final WebExtension.MessageDelegate messageDelegate = new WebExtension.MessageDelegate() {
        @Override
        public void onConnect(WebExtension.Port port) {
            port.setDelegate(new WebExtension.PortDelegate() {
                @Override
                public void onPortMessage(Object message, WebExtension.Port p) {
                    if (!(message instanceof JSONObject)) return;
                    final JSONObject m = (JSONObject) message;
                    final String sender = p.sender == null ? null : p.sender.url;
                    worker.execute(() -> {
                        String result = answer(m.optString("method"), m.optString("arg"), sender);
                        JSONObject reply = new JSONObject();
                        try {
                            reply.put("id", m.optInt("id"));
                            reply.put("result", result);
                        } catch (Exception ignored) {
                        }
                        runOnUiThread(() -> p.postMessage(reply));
                    });
                }

                @Override
                public void onDisconnect(WebExtension.Port p) {
                }
            });
        }
    };

    /** Bridge calls from the page. Only the configured shop site may use the printer. */
    String answer(String method, String arg, String senderUrl) {
        if (senderUrl == null || !sameSite(Uri.parse(senderUrl))) return "{\"ok\":false,\"message\":\"Trang này không được phép dùng máy in.\"}";
        switch (method) {
            case "info":
                try {
                    JSONObject o = new JSONObject(printer.info());
                    o.put("engine", "gecko");
                    return o.toString();
                } catch (Exception e) {
                    return printer.info();
                }
            case "printBase64":
                return printer.printBase64(arg);
            case "pageState":
                lastPageState = arg;
                Log.i(TAG, "page state: " + arg);
                return "ok";
            default:
                return "{\"ok\":false,\"message\":\"Không hỗ trợ\"}";
        }
    }

    static String errorText(int code) {
        switch (code) {
            case WebRequestError.ERROR_UNKNOWN_HOST: return "không tìm được địa chỉ tên miền (DNS)";
            case WebRequestError.ERROR_NET_TIMEOUT: return "hết thời gian chờ";
            case WebRequestError.ERROR_CONNECTION_REFUSED: return "máy chủ từ chối kết nối";
            case WebRequestError.ERROR_NET_RESET: case WebRequestError.ERROR_NET_INTERRUPT: return "kết nối bị ngắt";
            case WebRequestError.ERROR_OFFLINE: return "thiết bị đang ngoại tuyến";
            case WebRequestError.ERROR_SECURITY_SSL: case WebRequestError.ERROR_SECURITY_BAD_CERT: return "lỗi chứng chỉ bảo mật (kiểm tra ngày giờ của máy)";
            default: return "lỗi mạng";
        }
    }

    /** Device DNS and DNS-over-HTTPS lookups for the error page. Network I/O: worker thread only. */
    static String diagnose(String host) {
        StringBuilder sb = new StringBuilder();
        try {
            InetAddress[] a = InetAddress.getAllByName(host);
            sb.append("DNS của máy: ").append(host).append(" → ").append(a[0].getHostAddress());
        } catch (Exception e) {
            sb.append("DNS của máy: không phân giải được ").append(host);
        }
        sb.append("\nDNS qua HTTPS (1.1.1.1): ");
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(DOH_URL + "?type=A&name=" + host).openConnection();
            c.setRequestProperty("Accept", "application/dns-json");
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            try (InputStream in = c.getInputStream(); Scanner sc = new Scanner(in, "UTF-8").useDelimiter("\\A")) {
                String body = sc.hasNext() ? sc.next() : "";
                java.util.regex.Matcher m = java.util.regex.Pattern.compile("\"data\":\"(\\d+\\.\\d+\\.\\d+\\.\\d+)\"").matcher(body);
                sb.append(m.find() ? "được → " + m.group(1) : "không có kết quả");
            }
        } catch (Exception e) {
            sb.append("bị chặn hoặc lỗi (").append(e.getClass().getSimpleName()).append(")");
        } finally {
            if (c != null) c.disconnect();
        }
        return sb.toString();
    }

    private String baseUrl() {
        return prefs.getString("base", BuildConfig.DEFAULT_URL);
    }

    String startUrl() {
        return baseUrl() + "/";
    }

    private boolean sameSite(Uri uri) {
        Uri base = Uri.parse(baseUrl());
        return "https".equals(uri.getScheme()) && uri.getHost() != null && uri.getHost().equalsIgnoreCase(base.getHost());
    }

    /** Returns true when the app handled the URL itself (the page must not navigate). */
    boolean handleUrl(String url) {
        if (url == null) return true;
        // RawBT links produced by the web app ("intent:base64,...#Intent;scheme=rawbt;...") or "rawbt:base64,..."
        if ((url.startsWith("intent:") && url.contains("scheme=rawbt")) || url.startsWith("rawbt:")) {
            int start = url.indexOf("base64,"), end = url.indexOf('#');
            if (start < 0) return true;
            String b64 = url.substring(start + 7, end > start ? end : url.length());
            try {
                printAsync(Base64.decode(Uri.decode(b64), Base64.DEFAULT));
            } catch (IllegalArgumentException e) {
                toast("Dữ liệu in không hợp lệ.");
            }
            return true;
        }
        if (url.startsWith("lamanpos:")) {
            Uri u = Uri.parse(url);
            String host = u.getHost() == null ? "" : u.getHost();
            if (host.equals("settings")) showMenu();
            else if (host.equals("print-lines")) printLines(u.getQueryParameter("data"), u.getQueryParameter("paper"));
            else if (host.equals("test-print")) testPrint();
            return true;
        }
        if (url.startsWith("about:") || url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("resource:") || url.startsWith("moz-extension:")) return false;
        if (url.startsWith("http://") || url.startsWith("https://")) {
            Uri u = Uri.parse(url);
            if (sameSite(u)) return false;
            if (u.getHost() != null && u.getHost().endsWith(".supabase.co")) return false;
            openExternal(u);
            return true;
        }
        if (url.startsWith("intent:")) {
            try {
                startActivity(Intent.parseUri(url, Intent.URI_INTENT_SCHEME));
            } catch (Exception e) {
                toast("Không mở được liên kết này.");
            }
            return true;
        }
        openExternal(Uri.parse(url));
        return true;
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            toast("Không có ứng dụng mở được liên kết này.");
        }
    }

    private void printAsync(final byte[] data) {
        toast("Đang in…");
        worker.execute(() -> {
            final String msg = printer.printRaw(data).optString("message");
            runOnUiThread(() -> toast(msg));
        });
    }

    /** Lite version: lines are laid out by the server; rendered here with the Vietnamese system font. */
    private void printLines(String data, String paperParam) {
        if (data == null) return;
        final int paper = "80".equals(paperParam) ? 80 : 58;
        final String json;
        try {
            json = new String(Base64.decode(data, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING), "UTF-8");
        } catch (Exception e) {
            toast("Dữ liệu in không hợp lệ.");
            return;
        }
        toast("Đang in…");
        worker.execute(() -> {
            String msg;
            try {
                msg = printer.printRaw(ReceiptRenderer.render(json, paper)).optString("message");
            } catch (Exception e) {
                msg = "Không tạo được bản in: " + e.getMessage();
            }
            final String m = msg;
            runOnUiThread(() -> toast(m));
        });
    }

    private void testPrint() {
        worker.execute(() -> {
            String msg;
            try {
                JSONObject info = new JSONObject(printer.info());
                int paper = info.optInt("paper", 0) == 80 ? 80 : 58, chars = paper == 80 ? 48 : 32;
                StringBuilder ruler = new StringBuilder(), edge = new StringBuilder("|<");
                for (int i = 1; i <= chars; i++) ruler.append(i % 10);
                while (edge.length() < chars - 2) edge.append(' ');
                edge.append(">|");
                JSONArray lines = new JSONArray();
                lines.put(line("IN THỬ - LAM AN POS", 1, 2));
                lines.put(line(Build.MANUFACTURER + " " + Build.MODEL + " · Android " + Build.VERSION.RELEASE, 0, 0));
                lines.put(line("Máy in: " + info.optString("statusText", "?") + " · " + paper + "mm", 0, 0));
                lines.put(line(edge.toString(), 0, 0));
                lines.put(line(ruler.toString(), 0, 0));
                lines.put(line("ĂÂĐÊÔƠƯ ăâđêôơư ếềểễệ", 0, 0));
                lines.put(line("Cà phê sữa đá, Trà đào", 1, 1));
                JSONArray pages = new JSONArray();
                pages.put(lines);
                msg = printer.printRaw(ReceiptRenderer.render(pages.toString(), paper)).optString("message");
            } catch (Exception e) {
                msg = "In thử lỗi: " + e.getMessage();
            }
            final String m = msg;
            runOnUiThread(() -> toast(m));
        });
    }

    private static JSONArray line(String text, int bold, int size) {
        JSONArray a = new JSONArray();
        a.put(text);
        a.put(bold);
        a.put(size);
        return a;
    }

    private String deviceLine() {
        return Build.MANUFACTURER + " " + Build.MODEL + " · Android " + Build.VERSION.RELEASE + " · App " + BuildConfig.VERSION_NAME;
    }

    private String problemPage(String title, String text, String detail, String retry) {
        String html = "<html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width'></head><body style='font-family:sans-serif;padding:24px;color:#21362c'>"
                + "<h2>" + escape(title) + "</h2><p>" + escape(text) + "</p><p style='color:#777;font-size:13px'>" + escape(detail).replace("\n", "<br>") + "<br>" + escape(deviceLine()) + "</p>"
                + "<p><a href='" + escape(retry) + "' style='font-size:20px;display:inline-block;background:#245344;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none'>Thử lại</a></p>"
                + "<p><a href='lamanpos://settings'>Cài đặt ứng dụng</a></p></body></html>";
        try {
            return "data:text/html;charset=utf-8;base64," + Base64.encodeToString(html.getBytes("UTF-8"), Base64.NO_WRAP);
        } catch (Exception e) {
            return "about:blank";
        }
    }

    private void showMenu() {
        String[] items = {"Tải lại trang", "In thử máy in tích hợp", "Đổi địa chỉ trang web…"};
        new AlertDialog.Builder(this)
                .setTitle("Lam An POS")
                .setMessage(deviceLine())
                .setItems(items, (d, which) -> {
                    if (which == 0) session.loadUri(startUrl());
                    else if (which == 1) testPrint();
                    else askBaseUrl();
                })
                .setNegativeButton("Đóng", null)
                .show();
    }

    private void askBaseUrl() {
        final EditText input = new EditText(this);
        input.setText(baseUrl());
        input.setSingleLine(true);
        new AlertDialog.Builder(this)
                .setTitle("Địa chỉ trang web của quán")
                .setView(input)
                .setPositiveButton("Lưu", (d, w) -> {
                    String v = input.getText().toString().trim().replaceAll("/+$", "");
                    if (!v.startsWith("https://")) {
                        toast("Địa chỉ phải bắt đầu bằng https://");
                        return;
                    }
                    prefs.edit().putString("base", v).apply();
                    session.loadUri(startUrl());
                })
                .setNegativeButton("Hủy", null)
                .show();
    }

    private void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
    }

    private static String escape(String s) {
        return s == null ? "" : s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("'", "&#39;").replace("\"", "&quot;");
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            event.startTracking();
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            showMenu();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyLongPress(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            showMenu();
            return true;
        }
        return super.onKeyLongPress(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && event.isTracking() && !event.isCanceled()) {
            if (canGoBack) session.goBack();
            else moveTaskToBack(true);
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        printer.disconnect();
        if (session != null) session.close();
        worker.shutdown();
        super.onDestroy();
    }
}
