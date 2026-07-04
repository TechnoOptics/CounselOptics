package com.advottic.app;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

/**
 * Phone -> home-screen widget bridge.
 *
 * The Advottic phone app is a Capacitor webview, so the case data
 * lives in JS. This LOCAL plugin lets the web app hand the same tiny
 * glance summary it already computes for the watch (open-case count,
 * latest update, upcoming hearings, recent actions) down to native,
 * where it is written to SharedPreferences that {@link CasesWidgetProvider}
 * reads to render the home-screen App Widget.
 *
 * Android widgets run in the app's own process, so plain MODE_PRIVATE
 * SharedPreferences are readable by the widget provider - no App Group
 * equivalent needed (that's an iOS concern).
 *
 * Registered in MainActivity via registerPlugin() because it is a
 * LOCAL plugin (not an npm package) and so is not in the
 * cap-sync-generated capacitor.plugins.json. Best-effort + never
 * rejects on a widget-side hiccup so it can't break the phone UX.
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    /** Shared prefs file the widget provider reads. */
    static final String PREFS = "advottic_widget";

    static final String KEY_OPEN_COUNT = "openCount";
    static final String KEY_LATEST_TITLE = "latestTitle";
    static final String KEY_LATEST_CASE_ID = "latestCaseId";
    static final String KEY_NEXT_HEARING_AT = "nextHearingAt";
    static final String KEY_NEXT_HEARING_TITLE = "nextHearingTitle";
    static final String KEY_UPCOMING_JSON = "upcomingJson";
    static final String KEY_ACTIONS_JSON = "actionsJson";
    static final String KEY_SYNCED_AT = "syncedAt";

    @PluginMethod
    public void sync(PluginCall call) {
        int openCount = call.getInt("openCount", 0);
        String latestTitle = call.getString("latestTitle", "");
        String latestCaseId = call.getString("latestCaseId", "");
        if (latestTitle == null) latestTitle = "";
        if (latestCaseId == null) latestCaseId = "";
        // Epoch millis exceeds int range; JS numbers are doubles.
        Double nextHearingAtD = call.getDouble("nextHearingAt", 0d);
        long nextHearingAt = nextHearingAtD == null ? 0L : nextHearingAtD.longValue();
        String nextHearingTitle = call.getString("nextHearingTitle", "");
        if (nextHearingTitle == null) nextHearingTitle = "";
        JSONArray upcoming = call.getArray("upcoming");
        String upcomingJson = upcoming == null ? "[]" : upcoming.toString();
        JSONArray actions = call.getArray("actions");
        String actionsJson = actions == null ? "[]" : actions.toString();

        try {
            Context ctx = getContext();
            SharedPreferences.Editor e =
                ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
            e.putInt(KEY_OPEN_COUNT, openCount);
            e.putString(KEY_LATEST_TITLE, latestTitle);
            e.putString(KEY_LATEST_CASE_ID, latestCaseId);
            e.putLong(KEY_NEXT_HEARING_AT, nextHearingAt);
            e.putString(KEY_NEXT_HEARING_TITLE, nextHearingTitle);
            e.putString(KEY_UPCOMING_JSON, upcomingJson);
            e.putString(KEY_ACTIONS_JSON, actionsJson);
            e.putLong(KEY_SYNCED_AT, System.currentTimeMillis());
            e.apply();

            // Ask any placed widgets to re-render from the fresh data.
            CasesWidgetProvider.refreshAll(ctx);
            call.resolve();
        } catch (Exception ex) {
            call.reject("widget sync failed: " + ex.getMessage());
        }
    }
}
