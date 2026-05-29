import SwiftUI

@main
struct TaskWidgetApp: App {
    @State private var openedRoute: String = "dashboard"

    var body: some Scene {
        WindowGroup {
            ContentView(openedRoute: openedRoute)
                .onOpenURL { url in
                    openedRoute = url.host ?? "dashboard"
                }
        }
        .windowStyle(.hiddenTitleBar)
    }
}
