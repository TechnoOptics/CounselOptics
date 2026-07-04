#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Registers the Swift WidgetBridgePlugin with Capacitor via the ObjC
// runtime - the same mechanism every Capacitor plugin uses. The plugin
// name "WidgetBridge" must match registerPlugin<...>('WidgetBridge') on
// the web side (components/WidgetSync.tsx).
CAP_PLUGIN(WidgetBridgePlugin, "WidgetBridge",
    CAP_PLUGIN_METHOD(sync, CAPPluginReturnPromise);
)
