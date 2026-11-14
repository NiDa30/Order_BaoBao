package vn.laman.pos;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.util.Base64;
import android.view.KeyEvent;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Lam An POS for Android POS terminals: opens the shop's web app and prints bills on the built-in
 * SUNMI printer. Handles RawBT print links itself, so neither the full nor the Lite web version needs RawBT.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "lam-an-pos";
    private WebView web;
    private SharedPreferences prefs;
    private PrinterBridge printer;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        printer = new PrinterBridge(this);
        printer.connect();

        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setUserAgentString(s.getUserAgentString() + " LamAnPOS/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= 21) CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.addJavascriptInterface(printer, "LamAnAndroid");
        web.setWebChromeClient(new WebChromeClient()); // alert()/confirm() dialogs used by the web app
        web.setWebViewClient(new WebViewClient() {
            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(url);
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                String retry = failingUrl != null && failingUrl.startsWith("http") ? failingUrl : startUrl();
                view.loadDataWithBaseURL(null, "<html><head><meta name='viewport' content='width=device-width'></head><body style='font-family:sans-serif;padding:24px'>"
                        + "<h2>Không kết nối được</h2><p>Kiểm tra Wi-Fi hoặc mạng rồi thử lại.</p><p style='color:#777'>" + escape(description) + "</p>"
                        + "<p><a href='" + escape(retry) + "' style='font-size:20px'>Thử lại</a></p>"
                        + "<p><a href='lamanpos://settings'>Cài đặt ứng dụng</a></p></body></html>", "text/html", "utf-8", null);
            }
        });
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> download(url, userAgent, contentDisposition, mimeType));

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else if (!prefs.contains("url")) chooseVersion(true);
        else web.loadUrl(startUrl());
    }

    private String baseUrl() {
        return prefs.getString("base", BuildConfig.DEFAULT_URL);
    }

    private String startUrl() {
        return prefs.getString("url", baseUrl() + "/");
    }

    private boolean sameSite(Uri uri) {
        Uri base = Uri.parse(baseUrl());
        return uri.getHost() != null && uri.getHost().equalsIgnoreCase(base.getHost());
    }

    private boolean handleUrl(String url) {
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
            if (host.equals("settings")) chooseVersion(false);
            else if (host.equals("print-lines")) printLines(u.getQueryParameter("data"), u.getQueryParameter("paper"));
            else if (host.equals("test-print")) testPrint();
            return true;
        }
        if (url.startsWith("http://") || url.startsWith("https://")) {
            if (sameSite(Uri.parse(url))) return false;
            openExternal(Uri.parse(url));
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
        new Thread(() -> {
            JSONObject r = printer.printRaw(data);
            final String msg = r.optString("message");
            runOnUiThread(() -> toast(msg));
        }).start();
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
        new Thread(() -> {
            String msg;
            try {
                msg = printer.printRaw(ReceiptRenderer.render(json, paper)).optString("message");
            } catch (Exception e) {
                msg = "Không tạo được bản in: " + e.getMessage();
            }
            final String m = msg;
            runOnUiThread(() -> toast(m));
        }).start();
    }

    private void testPrint() {
        new Thread(() -> {
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
        }).start();
    }

    private static JSONArray line(String text, int bold, int size) {
        JSONArray a = new JSONArray();
        a.put(text);
        a.put(bold);
        a.put(size);
        return a;
    }

    private void chooseVersion(final boolean firstRun) {
        final String base = baseUrl();
        String[] items = {
                "Bản đầy đủ (khuyên dùng)",
                "Bản Lite (máy cũ, mạng yếu)",
                "Đổi địa chỉ trang web…",
                "In thử máy in tích hợp",
                "Tải lại trang"
        };
        new AlertDialog.Builder(this)
                .setTitle("Lam An POS · " + BuildConfig.VERSION_NAME)
                .setCancelable(!firstRun)
                .setItems(items, (d, which) -> {
                    if (which == 0) open(base + "/");
                    else if (which == 1) open(base + "/lite");
                    else if (which == 2) askBaseUrl();
                    else if (which == 3) testPrint();
                    else web.reload();
                })
                .show();
    }

    private void open(String url) {
        prefs.edit().putString("url", url).apply();
        web.loadUrl(url);
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
                    prefs.edit().putString("base", v).remove("url").apply();
                    chooseVersion(true);
                })
                .setNegativeButton("Hủy", null)
                .show();
    }

    private void download(String url, String userAgent, String contentDisposition, String mimeType) {
        if (url.startsWith("blob:") || url.startsWith("data:")) {
            toast("Ứng dụng chưa tải được file tạo trên trang. Hãy xuất dữ liệu ở bản Lite hoặc trên máy tính.");
            return;
        }
        if (Build.VERSION.SDK_INT >= 23 && Build.VERSION.SDK_INT <= 28
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, 1);
            toast("Cho phép lưu file rồi bấm tải lại.");
            return;
        }
        try {
            String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            req.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url));
            req.addRequestHeader("User-Agent", userAgent);
            req.setMimeType(mimeType);
            req.setTitle(name);
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(req);
            toast("Đang tải " + name + " vào thư mục Download.");
        } catch (Exception e) {
            toast("Không tải được file: " + e.getMessage());
        }
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
            chooseVersion(false);
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyLongPress(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            chooseVersion(false);
            return true;
        }
        return super.onKeyLongPress(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && event.isTracking() && !event.isCanceled()) {
            if (web.canGoBack()) web.goBack();
            else moveTaskToBack(true);
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        printer.disconnect();
        web.destroy();
        super.onDestroy();
    }
}
