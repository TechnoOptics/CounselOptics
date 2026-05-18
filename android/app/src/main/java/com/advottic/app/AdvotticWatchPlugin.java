package com.advottic.app;

import android.app.UiModeManager;
import android.content.Context;
import android.content.res.Configuration;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.PutDataMapRequest;
import com.google.android.gms.wearable.PutDataRequest;
import com.google.android.gms.wearable.Wearable;

import org.json.JSONArray;

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
    private static final String WATCH_CAPABILITY = "advottic_watch_app";

    /**
     * Tells the web layer about the watch, two ways:
     *
     *  - isWatch: is THIS device a watch-class device. The phone app
     *    normally never runs on the watch (the watch is a separate
     *    native module), but the web layer gets a reliable signal.
     *  - watchPaired / watchReachable / watchAppInstalled: whether a
     *    Wear OS node is connected, and whether one of them actually
     *    advertises the Advottic watch-app capability - so the phone
     *    can show real watch status instead of guessing.
     *
     * Resolves a single object; always resolves (never rejects) with
     * safe defaults so a missing/odd Wear stack never breaks the UI.
     */
    @PluginMethod
    public void watchStatus(PluginCall call) {
        final JSObject ret = new JSObject();

        boolean isWatch = false;
        try {
            UiModeManager ui = (UiModeManager) getContext()
                .getSystemService(Context.UI_MODE_SERVICE);
            if (ui != null
                && ui.getCurrentModeType()
                    == Configuration.UI_MODE_TYPE_WATCH) {
                isWatch = true;
            }
            if (getContext().getPackageManager()
                .hasSystemFeature("android.hardware.type.watch")) {
                isWatch = true;
            }
        } catch (Exception ignored) {
            // Form-factor probe is best-effort.
        }
        ret.put("isWatch", isWatch);

        try {
            Wearable.getNodeClient(getContext()).getConnectedNodes()
                .addOnSuccessListener(nodes -> {
                    boolean any = nodes != null && !nodes.isEmpty();
                    ret.put("watchPaired", any);
                    ret.put("watchReachable", any);
                    ret.put("nodeCount", nodes == null ? 0 : nodes.size());
                    Wearable.getCapabilityClient(getContext())
                        .getCapability(
                            WATCH_CAPABILITY,
                            CapabilityClient.FILTER_REACHABLE)
                        .addOnSuccessListener(info -> {
                            ret.put(
                                "watchAppInstalled",
                                !info.getNodes().isEmpty());
                            call.resolve(ret);
                        })
                        .addOnFailureListener(e -> {
                            ret.put("watchAppInstalled", false);
                            call.resolve(ret);
                        });
                })
                .addOnFailureListener(e -> {
                    ret.put("watchPaired", false);
                    ret.put("watchReachable", false);
                    ret.put("watchAppInstalled", false);
                    ret.put("nodeCount", 0);
                    call.resolve(ret);
                });
        } catch (Exception e) {
            ret.put("watchPaired", false);
            ret.put("watchReachable", false);
            ret.put("watchAppInstalled", false);
            ret.put("nodeCount", 0);
            call.resolve(ret);
        }
    }

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
        // The next few upcoming hearings (the wrist "docket"). Passed
        // as a JS array of {at,title}; forwarded verbatim as a JSON
        // string so the watch stays the only place that parses it.
        JSONArray upcoming = call.getArray("upcoming");
        String upcomingJson = upcoming == null ? "[]" : upcoming.toString();
        // Action Center items ({text,urgent}) - things acted on the
        // user's case or that they need to do. Same verbatim-JSON
        // forwarding as the docket.
        JSONArray actions = call.getArray("actions");
        String actionsJson = actions == null ? "[]" : actions.toString();

        try {
            PutDataMapRequest req = PutDataMapRequest.create(PATH);
            req.getDataMap().putInt("openCount", openCount);
            req.getDataMap().putString("latestTitle", latestTitle);
            req.getDataMap().putString("latestCaseId", latestCaseId);
            req.getDataMap().putLong("nextHearingAt", nextHearingAt);
            req.getDataMap().putString("nextHearingTitle", nextHearingTitle);
            req.getDataMap().putString("upcomingJson", upcomingJson);
            req.getDataMap().putString("actionsJson", actionsJson);
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
