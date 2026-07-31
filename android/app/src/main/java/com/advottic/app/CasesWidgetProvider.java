package com.advottic.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Home-screen App Widget showing the user's open cases at a glance:
 * the open-case count, the most recently updated case, the next
 * hearing (as a relative countdown), and the top recent action.
 *
 * Data comes from the SharedPreferences that {@link WidgetBridgePlugin}
 * writes when the web app hands down its glance summary. When nothing
 * has synced yet (fresh install, signed out) the widget shows a calm
 * "Open Advottic" prompt rather than zeros.
 *
 * Tapping anywhere opens the app (to the cases list via a deep link).
 */
public class CasesWidgetProvider extends AppWidgetProvider {

    /** Re-render every placed instance of this widget. Called by the
     *  bridge plugin after it writes fresh data. */
    static void refreshAll(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        ComponentName cn = new ComponentName(context, CasesWidgetProvider.class);
        int[] ids = mgr.getAppWidgetIds(cn);
        for (int id : ids) {
            renderWidget(context, mgr, id);
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) {
            renderWidget(context, mgr, id);
        }
    }

    private static void renderWidget(Context context, AppWidgetManager mgr, int id) {
        RemoteViews views =
            new RemoteViews(context.getPackageName(), R.layout.widget_cases);

        SharedPreferences prefs = context.getSharedPreferences(
            WidgetBridgePlugin.PREFS, Context.MODE_PRIVATE);
        boolean hasData = prefs.getLong(WidgetBridgePlugin.KEY_SYNCED_AT, 0L) > 0L;

        int openCount = prefs.getInt(WidgetBridgePlugin.KEY_OPEN_COUNT, 0);
        String latestTitle =
            prefs.getString(WidgetBridgePlugin.KEY_LATEST_TITLE, "");
        long nextHearingAt =
            prefs.getLong(WidgetBridgePlugin.KEY_NEXT_HEARING_AT, 0L);
        String nextHearingTitle =
            prefs.getString(WidgetBridgePlugin.KEY_NEXT_HEARING_TITLE, "");
        String actionsJson =
            prefs.getString(WidgetBridgePlugin.KEY_ACTIONS_JSON, "[]");

        if (!hasData) {
            views.setTextViewText(R.id.widget_open_count, "");
            views.setTextViewText(R.id.widget_open_label, "Not synced");
            views.setTextViewText(R.id.widget_latest, "Open Advottic to sync");
            views.setTextViewText(R.id.widget_hearing, "");
            views.setTextViewText(R.id.widget_action, "");
        } else {
            views.setTextViewText(
                R.id.widget_open_count, String.valueOf(openCount));
            views.setTextViewText(
                R.id.widget_open_label, openCount == 1 ? "Open case" : "Open cases");

            views.setTextViewText(
                R.id.widget_latest,
                latestTitle.isEmpty() ? "No open cases" : latestTitle);

            // Next hearing as a relative countdown.
            if (nextHearingAt > 0L) {
                views.setTextViewText(
                    R.id.widget_hearing,
                    "Next hearing " + relativeWhen(nextHearingAt)
                        + (nextHearingTitle.isEmpty() ? "" : " · " + nextHearingTitle));
            } else {
                views.setTextViewText(R.id.widget_hearing, "No upcoming hearings");
            }

            // Top recent action, if any.
            String action = firstAction(actionsJson);
            views.setTextViewText(R.id.widget_action, action);
        }

        views.setOnClickPendingIntent(R.id.widget_root, launchIntent(context));
        mgr.updateAppWidget(id, views);
    }

    /** Human relative time like "in 3h" / "in 2d" / "now". */
    private static String relativeWhen(long epochMs) {
        long delta = epochMs - System.currentTimeMillis();
        if (delta <= 0) return "now";
        long mins = delta / 60000L;
        if (mins < 60) return "in " + mins + "m";
        long hours = mins / 60L;
        if (hours < 24) return "in " + hours + "h";
        long days = hours / 24L;
        return "in " + days + "d";
    }

    /** Text of the first action item, or empty string. */
    private static String firstAction(String actionsJson) {
        try {
            JSONArray arr = new JSONArray(actionsJson);
            if (arr.length() == 0) return "";
            JSONObject o = arr.getJSONObject(0);
            String text = o.optString("text", "");
            boolean urgent = o.optBoolean("urgent", false);
            return (urgent ? "⚠ " : "") + text;
        } catch (Exception e) {
            return "";
        }
    }

    /** Open the app (cases list) when the widget is tapped. */
    private static PendingIntent launchIntent(Context context) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(Intent.ACTION_MAIN);
        intent.addCategory(Intent.CATEGORY_LAUNCHER);
        // Hint the app to open the cases list. MainActivity is a
        // remote-URL WebView; the deep-link data is a best-effort
        // signal, harmless if unused.
        intent.setData(android.net.Uri.parse("https://advottic.com/cases"));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        // FLAG_IMMUTABLE is required on API 31+ (targetSdk 36).
        flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(context, 0, intent, flags);
    }
}
