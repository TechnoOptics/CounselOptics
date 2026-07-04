package com.advottic.app;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the LOCAL Wear bridge plugin. Local (non-npm)
        // plugins are not in the cap-sync-generated
        // capacitor.plugins.json, so they must be registered here
        // BEFORE super.onCreate so the Capacitor bridge picks them
        // up. This file is committed and `cap sync` does not
        // overwrite it, so the registration persists across CI.
        registerPlugin(AdvotticWatchPlugin.class);
        // Home-screen widget bridge (writes SharedPreferences the
        // CasesWidgetProvider reads). Same local-plugin registration
        // rule as the watch bridge above.
        registerPlugin(WidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);

        // White status-bar icons. targetSdk 36 enforces edge-to-edge,
        // which makes the theme's android:windowLightStatusBar /
        // statusBarColor inert - the appearance MUST be set
        // programmatically. false => light (white) status-bar
        // content, to sit on the dark forest header. After
        // super.onCreate so the Capacitor BridgeActivity window
        // exists.
        WindowInsetsControllerCompat insets =
            WindowCompat.getInsetsController(
                getWindow(), getWindow().getDecorView());
        insets.setAppearanceLightStatusBars(false);
    }
}
