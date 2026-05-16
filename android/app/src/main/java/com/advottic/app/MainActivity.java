package com.advottic.app;

import android.os.Bundle;
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
        super.onCreate(savedInstanceState);
    }
}
