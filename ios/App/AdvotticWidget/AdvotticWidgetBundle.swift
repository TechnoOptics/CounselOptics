import WidgetKit
import SwiftUI

// Entry point for the widget extension. A bundle can hold multiple
// widgets later (e.g. a lock-screen accessory); for now it's the one
// "Open cases" home-screen widget.
@main
struct AdvotticWidgetBundle: WidgetBundle {
    var body: some Widget {
        AdvotticWidget()
    }
}
