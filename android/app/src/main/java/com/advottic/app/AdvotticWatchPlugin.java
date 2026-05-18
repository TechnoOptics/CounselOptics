package com.advottic.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.wearable.PutDataMapRequest;
import com.google.android.gms.wearable.PutDataRequest;
import com.google.android.gms.wearable.Wearable;

/**
 * Phone -> Wear OS bridge (Wear Phase 2).
 *
 * The Advottic phone app is a Capacitor webview, so the case data
 * lives in JS. This local plugin lets the web app hand a tiny
 * summary (open-case count + latest update + the case id for an
 * "open on phone" hand-off) down to native, which pushes it over
 * the Wearable Data Layer to the watch module (com.advottic.watch),
 * where SummaryListenerService receives it.
 *
 * Written in Java on purpose: the phone app target is Java, so this
 * needs no Kotlin/Compose added to :app (that stays isolated to the
 * :wear module) - keeping the shipped phone build low-risk.
 *
 * Registered in MainActivity via registerPlugin() because it is a
 * LOCAL plugin (not an npm package) and so is not in the
 * cap-sync-generated capacitor.plugins.json.
 */
@CapacitorPlugin(name = "AdvotticWatch")
public class AdvotticWatchPlugin extends Plugin {

    private static final String PATH = "/advottic/summary";

    @PluginMethod
    public void sync(PluginCall call) {
        int openCount = call.getInt("openCount", 0);
        String latestTitle = call.getString("latestTitle", "");
        String latestCaseId = call.getString("latestCaseId", "");
        if (latestTitle == null) latestTitle = "";
        if (latestCaseId == null) latestCaseId = "";
        // Epoch millis exceeds int range; JS numbers are doubles, so
        // read as double and narrow to long. 0 = no upcoming hearing.
        Double nextHearingAtD = call.getDouble("nextHearingAt", 0d);
        long nextHearingAt = nextHearingAtD == null ? 0L : nextHearingAtD.longValue();
        String nextHearingTitle = call.getString("nextHearingTitle", "");
        if (nextHearingTitle == null) nextHearingTitle = "";

        try {
            PutDataMapRequest req = PutDataMapRequest.create(PATH);
            req.getDataMap().putInt("openCount", openCount);
            req.getDataMap().putString("latestTitle", latestTitle);
            req.getDataMap().putString("latestCaseId", latestCaseId);
            req.getDataMap().putLong("nextHearingAt", nextHearingAt);
            req.getDataMap().putString("nextHearingTitle", nextHearingTitle);
            // A changing timestamp guarantees the DataItem differs
            // from the last one, so the Data Layer actually re-emits
            // it to the watch instead of de-duping an identical
            // payload (e.g. same counts on a refresh).
            req.getDataMap().putLong("ts", System.currentTimeMillis());

            PutDataRequest putReq = req.asPutDataRequest();
            putReq.setUrgent();
            // Fire-and-forget: the watch may not be paired/reachable
            // and that's fine - this is a best-effort glance, never a
            // blocker for the phone UX.
            Wearable.getDataClient(getContext()).putDataItem(putReq);
            call.resolve();
        } catch (Exception e) {
            call.reject("watch sync failed: " + e.getMessage());
        }
    }
}
