package vn.laman.pos;

import android.content.Context;
import android.os.Build;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import com.sunmi.peripheral.printer.InnerPrinterCallback;
import com.sunmi.peripheral.printer.InnerPrinterException;
import com.sunmi.peripheral.printer.InnerPrinterManager;
import com.sunmi.peripheral.printer.InnerResultCallback;
import com.sunmi.peripheral.printer.SunmiPrinterService;

import org.json.JSONObject;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Bridge between the web app and the SUNMI built-in thermal printer.
 * Exposed to JavaScript as window.LamAnAndroid (info(), printBase64()).
 * The web app sends ready-made ESC/POS bytes (GS v 0 raster for Vietnamese text).
 */
public class PrinterBridge {
    private final Context context;
    private volatile SunmiPrinterService service;
    private final InnerPrinterCallback callback = new InnerPrinterCallback() {
        @Override
        protected void onConnected(SunmiPrinterService s) {
            service = s;
        }

        @Override
        protected void onDisconnected() {
            service = null;
        }
    };

    public PrinterBridge(Context context) {
        this.context = context.getApplicationContext();
    }

    public void connect() {
        try {
            InnerPrinterManager.getInstance().bindService(context, callback);
        } catch (InnerPrinterException e) {
            service = null;
        } catch (Throwable t) {
            service = null; // not a SUNMI device
        }
    }

    public void disconnect() {
        try {
            InnerPrinterManager.getInstance().unBindService(context, callback);
        } catch (Throwable ignored) {
        }
    }

    private SunmiPrinterService waitService() {
        if (service == null) connect();
        for (int i = 0; i < 20 && service == null; i++) {
            try {
                Thread.sleep(100);
            } catch (InterruptedException e) {
                break;
            }
        }
        return service;
    }

    private int state(SunmiPrinterService s) {
        try {
            return s.updatePrinterState();
        } catch (Throwable t) {
            return -1;
        }
    }

    static String stateMessage(int code) {
        switch (code) {
            case 1: return "Máy in sẵn sàng";
            case 2: return "Máy in đang khởi động";
            case 3: return "Lỗi kết nối máy in";
            case 4: return "Máy in hết giấy";
            case 5: return "Đầu in quá nóng";
            case 6: return "Nắp máy in đang mở";
            case 7: return "Dao cắt giấy bị lỗi";
            case 8: return "Dao cắt đã phục hồi";
            case 505: return "Không tìm thấy máy in";
            case 507: return "Cập nhật firmware máy in lỗi";
            default: return "Không đọc được trạng thái máy in (" + code + ")";
        }
    }

    /** Device and printer information for printer detection in the web app. */
    @JavascriptInterface
    public String info() {
        JSONObject o = new JSONObject();
        try {
            o.put("app", "lam-an-pos");
            o.put("version", BuildConfig.VERSION_NAME);
            o.put("model", Build.MODEL);
            o.put("manufacturer", Build.MANUFACTURER);
            o.put("android", Build.VERSION.RELEASE);
            SunmiPrinterService s = waitService();
            o.put("printer", s != null ? "sunmi" : "none");
            if (s != null) {
                int st = state(s);
                o.put("status", st);
                o.put("statusText", stateMessage(st));
                try {
                    int paper = s.getPrinterPaper();
                    o.put("paper", paper == 2 ? 80 : paper == 1 ? 58 : 0);
                } catch (Throwable ignored) {
                    // Older printer services do not report paper width.
                }
            }
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    /** Print ESC/POS bytes (base64). Blocks this JS bridge thread until the printer answers. */
    @JavascriptInterface
    public String printBase64(String b64) {
        byte[] data;
        try {
            data = Base64.decode(b64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            return result(false, "Dữ liệu in không hợp lệ.");
        }
        return printRaw(data).toString();
    }

    public JSONObject printRaw(byte[] data) {
        SunmiPrinterService s = waitService();
        if (s == null) {
            return resultObject(false, "Không tìm thấy máy in tích hợp SUNMI trên thiết bị này.");
        }
        int st = state(s);
        if (st >= 3 && st != 8 && st != -1) {
            return resultObject(false, stateMessage(st) + ". Kiểm tra máy in rồi thử lại.");
        }
        final CountDownLatch done = new CountDownLatch(1);
        final boolean[] ok = {true};
        final String[] error = {null};
        try {
            s.sendRAWData(data, new InnerResultCallback() {
                @Override
                public void onRunResult(boolean isSuccess) {
                    ok[0] = isSuccess;
                    done.countDown();
                }

                @Override
                public void onReturnString(String value) {
                }

                @Override
                public void onRaiseException(int code, String msg) {
                    ok[0] = false;
                    error[0] = msg;
                    done.countDown();
                }

                @Override
                public void onPrintResult(int code, String msg) {
                }
            });
            done.await(15, TimeUnit.SECONDS);
        } catch (Throwable t) {
            return resultObject(false, "In không thành công: " + t.getMessage());
        }
        if (!ok[0]) {
            return resultObject(false, "Máy in báo lỗi" + (error[0] != null ? ": " + error[0] : "."));
        }
        return resultObject(true, "Đã in " + data.length + " byte trên máy in tích hợp.");
    }

    private static JSONObject resultObject(boolean ok, String message) {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", ok);
            o.put("confirmed", ok);
            o.put("message", message);
        } catch (Exception ignored) {
        }
        return o;
    }

    private static String result(boolean ok, String message) {
        return resultObject(ok, message).toString();
    }
}
