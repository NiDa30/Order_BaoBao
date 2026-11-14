package vn.laman.pos;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.app.TimePickerDialog;

import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoSession.PromptDelegate;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/**
 * GeckoView does not draw alert()/confirm(), <select> lists or date/time pickers by itself: the app must.
 * The web app uses confirm() (closing a draft, role changes), <select> (shift, filters, payment) and
 * date/datetime-local inputs (history, opening/closing shifts).
 */
final class GeckoPrompts implements PromptDelegate {
    private final Activity activity;

    GeckoPrompts(Activity activity) {
        this.activity = activity;
    }

    @Override
    public GeckoResult<PromptResponse> onAlertPrompt(GeckoSession session, AlertPrompt prompt) {
        final GeckoResult<PromptResponse> res = new GeckoResult<>();
        new AlertDialog.Builder(activity)
                .setMessage(prompt.message)
                .setPositiveButton("OK", null)
                .setOnDismissListener(d -> res.complete(prompt.dismiss()))
                .show();
        return res;
    }

    @Override
    public GeckoResult<PromptResponse> onButtonPrompt(GeckoSession session, ButtonPrompt prompt) {
        final GeckoResult<PromptResponse> res = new GeckoResult<>();
        final boolean[] answered = {false};
        new AlertDialog.Builder(activity)
                .setTitle(prompt.title)
                .setMessage(prompt.message)
                .setPositiveButton("Đồng ý", (d, w) -> {
                    answered[0] = true;
                    res.complete(prompt.confirm(ButtonPrompt.Type.POSITIVE));
                })
                .setNegativeButton("Hủy", (d, w) -> {
                    answered[0] = true;
                    res.complete(prompt.confirm(ButtonPrompt.Type.NEGATIVE));
                })
                .setOnDismissListener(d -> {
                    if (!answered[0]) res.complete(prompt.confirm(ButtonPrompt.Type.NEGATIVE));
                })
                .show();
        return res;
    }

    private static void flatten(ChoicePrompt.Choice[] choices, List<ChoicePrompt.Choice> out) {
        if (choices == null) return;
        for (ChoicePrompt.Choice c : choices) {
            if (c.items != null) flatten(c.items, out); // <optgroup>
            else if (!c.separator) out.add(c);
        }
    }

    @Override
    public GeckoResult<PromptResponse> onChoicePrompt(GeckoSession session, ChoicePrompt prompt) {
        final GeckoResult<PromptResponse> res = new GeckoResult<>();
        final List<ChoicePrompt.Choice> list = new ArrayList<>();
        flatten(prompt.choices, list);
        final String[] labels = new String[list.size()];
        int checked = -1;
        for (int i = 0; i < list.size(); i++) {
            labels[i] = list.get(i).label;
            if (list.get(i).selected) checked = i;
        }
        final boolean[] answered = {false};
        AlertDialog.Builder b = new AlertDialog.Builder(activity).setTitle(prompt.title);
        if (prompt.type == ChoicePrompt.Type.MULTIPLE) {
            final boolean[] sel = new boolean[list.size()];
            for (int i = 0; i < sel.length; i++) sel[i] = list.get(i).selected;
            b.setMultiChoiceItems(labels, sel, (d, w, isChecked) -> sel[w] = isChecked)
                    .setPositiveButton("OK", (d, w) -> {
                        List<String> ids = new ArrayList<>();
                        for (int i = 0; i < sel.length; i++) if (sel[i]) ids.add(list.get(i).id);
                        answered[0] = true;
                        res.complete(prompt.confirm(ids.toArray(new String[0])));
                    });
        } else {
            b.setSingleChoiceItems(labels, checked, (d, w) -> {
                if (list.get(w).disabled) return;
                answered[0] = true;
                res.complete(prompt.confirm(list.get(w)));
                d.dismiss();
            });
        }
        b.setOnDismissListener(d -> {
            if (!answered[0]) res.complete(prompt.dismiss());
        }).show();
        return res;
    }

    @Override
    public GeckoResult<PromptResponse> onDateTimePrompt(GeckoSession session, DateTimePrompt prompt) {
        final GeckoResult<PromptResponse> res = new GeckoResult<>();
        final Calendar cal = Calendar.getInstance();
        String v = prompt.defaultValue == null ? "" : prompt.defaultValue;
        try { // yyyy-MM-dd[THH:mm] or HH:mm
            if (v.matches("\\d{4}-\\d{2}-\\d{2}.*")) cal.set(Integer.parseInt(v.substring(0, 4)), Integer.parseInt(v.substring(5, 7)) - 1, Integer.parseInt(v.substring(8, 10)));
            int t = v.indexOf(':');
            if (t >= 2) {
                cal.set(Calendar.HOUR_OF_DAY, Integer.parseInt(v.substring(t - 2, t)));
                cal.set(Calendar.MINUTE, Integer.parseInt(v.substring(t + 1, t + 3)));
            }
        } catch (Exception ignored) {
        }
        final boolean[] answered = {false};
        final Runnable cancel = () -> {
            if (!answered[0]) res.complete(prompt.dismiss());
        };
        final int type = prompt.type;
        final TimePickerDialog.OnTimeSetListener onTime = (view, h, m) -> {
            answered[0] = true;
            String time = String.format(Locale.US, "%02d:%02d", h, m);
            if (type == DateTimePrompt.Type.DATETIME_LOCAL) {
                res.complete(prompt.confirm(String.format(Locale.US, "%04d-%02d-%02dT%s", cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH), time)));
            } else res.complete(prompt.confirm(time));
        };
        if (type == DateTimePrompt.Type.TIME) {
            TimePickerDialog d = new TimePickerDialog(activity, onTime, cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE), true);
            d.setOnDismissListener(x -> cancel.run());
            d.show();
            return res;
        }
        final boolean[] timeOpened = {false};
        DatePickerDialog d = new DatePickerDialog(activity, (view, y, mo, day) -> {
            cal.set(y, mo, day);
            if (type == DateTimePrompt.Type.DATETIME_LOCAL) {
                timeOpened[0] = true;
                TimePickerDialog td = new TimePickerDialog(activity, onTime, cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE), true);
                td.setOnDismissListener(x -> cancel.run());
                td.show();
                return;
            }
            answered[0] = true;
            if (type == DateTimePrompt.Type.MONTH) res.complete(prompt.confirm(String.format(Locale.US, "%04d-%02d", y, mo + 1)));
            else res.complete(prompt.confirm(String.format(Locale.US, "%04d-%02d-%02d", y, mo + 1, day)));
        }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH));
        d.setOnDismissListener(x -> {
            if (!timeOpened[0]) cancel.run();
        });
        d.setButton(DatePickerDialog.BUTTON_NEUTRAL, "Xóa", (x, w) -> {
            answered[0] = true;
            res.complete(prompt.confirm(""));
        });
        d.show();
        return res;
    }
}
