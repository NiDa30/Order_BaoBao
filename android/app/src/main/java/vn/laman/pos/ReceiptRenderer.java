package vn.laman.pos;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;

import org.json.JSONArray;

import java.io.ByteArrayOutputStream;

/**
 * Draws laid-out receipt lines (fixed character grid, same as src/receipt.js) with the system font,
 * which covers Vietnamese, and converts the bitmap to ESC/POS raster commands (GS v 0).
 * Used by the Lite version, which cannot render images in the browser.
 */
public final class ReceiptRenderer {
    private ReceiptRenderer() {
    }

    /** pages: [[[text, bold(0/1), size(0 normal, 1 tall, 2 big)], ...], ...] */
    public static byte[] render(String json, int paper) throws Exception {
        JSONArray pages = new JSONArray(json);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (int p = 0; p < pages.length(); p++) {
            Bitmap bmp = draw(pages.getJSONArray(p), paper);
            writeRaster(out, bmp);
            bmp.recycle();
            out.write(new byte[]{0x1b, 0x64, 4, 0x1d, 0x56, 0x42, 0x00}); // feed 4 lines + partial cut
        }
        return out.toByteArray();
    }

    public static Bitmap draw(JSONArray lines, int paper) throws Exception {
        int dots = paper == 80 ? 576 : 384, chars = paper == 80 ? 48 : 32;
        float cell = dots / (float) chars;
        int fs = Math.round(cell * 1.75f), base = (int) Math.ceil(fs * 1.45f);
        int height = 8;
        for (int i = 0; i < lines.length(); i++) height += lines.getJSONArray(i).optInt(2) > 0 ? base * 2 : base;
        Bitmap bmp = Bitmap.createBitmap(dots, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        canvas.drawColor(Color.WHITE);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(Color.BLACK);
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setTextSize(fs);
        int y = 0;
        for (int i = 0; i < lines.length(); i++) {
            JSONArray line = lines.getJSONArray(i);
            String text = line.optString(0);
            boolean bold = line.optInt(1) == 1;
            int size = line.optInt(2);
            int sx = size == 2 ? 2 : 1, sy = size > 0 ? 2 : 1;
            paint.setTypeface(bold ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
            float baseline = y + (base - Math.round(fs * 0.32f)) * sy;
            int x = 0;
            for (int k = 0; k < text.length(); ) {
                int cp = text.codePointAt(k);
                String ch = new String(Character.toChars(cp));
                k += Character.charCount(cp);
                if (cp != ' ') {
                    float w = paint.measureText(ch), squeeze = w > cell * 0.96f ? cell * 0.96f / w : 1f;
                    canvas.save();
                    canvas.translate((x + 0.5f) * cell * sx, baseline);
                    canvas.scale(squeeze * sx, sy);
                    canvas.drawText(ch, 0, 0, paint);
                    canvas.restore();
                }
                x++;
            }
            y += size > 0 ? base * 2 : base;
        }
        return bmp;
    }

    static void writeRaster(ByteArrayOutputStream out, Bitmap bmp) {
        int w = bmp.getWidth(), h = bmp.getHeight(), bytesPerRow = (w + 7) / 8;
        int[] px = new int[w * h];
        bmp.getPixels(px, 0, w, 0, 0, w, h);
        out.write(new byte[]{0x1b, 0x40}, 0, 2);
        for (int y0 = 0; y0 < h; y0 += 128) {
            int band = Math.min(128, h - y0);
            out.write(new byte[]{0x1d, 0x76, 0x30, 0x00, (byte) (bytesPerRow & 0xff), (byte) (bytesPerRow >> 8), (byte) (band & 0xff), (byte) (band >> 8)}, 0, 8);
            byte[] row = new byte[bytesPerRow * band];
            for (int y = 0; y < band; y++) {
                for (int x = 0; x < w; x++) {
                    int c = px[(y0 + y) * w + x];
                    int lum = (299 * ((c >> 16) & 0xff) + 587 * ((c >> 8) & 0xff) + 114 * (c & 0xff)) / 1000;
                    if (lum < 160) row[y * bytesPerRow + (x >> 3)] |= (byte) (0x80 >> (x & 7));
                }
            }
            out.write(row, 0, row.length);
        }
    }
}
