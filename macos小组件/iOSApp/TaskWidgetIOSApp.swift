import SwiftUI

@main
struct TaskWidgetIOSApp: App {
    @State private var openedRoute: String = "dashboard"

    var body: some Scene {
        WindowGroup {
            IOSContentView(openedRoute: openedRoute)
                .onOpenURL { url in
                    openedRoute = url.host ?? "dashboard"
                }
        }
    }
}
