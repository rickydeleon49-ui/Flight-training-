// swift-tools-version:5.3
// Standalone Apple-SDK-only core tests, runnable on a Mac without Tauri/UIKit.
import PackageDescription
let package = Package(
    name: "PdfViewerCore",
    platforms: [.macOS(.v10_15), .iOS(.v13)],
    products: [.library(name: "PdfViewerCore", targets: ["PdfViewerCore"])],
    targets: [
        .target(name: "PdfViewerCore", path: "Sources"),
        .testTarget(name: "PdfViewerCoreTests", dependencies: ["PdfViewerCore"], path: "Tests")
    ]
)
