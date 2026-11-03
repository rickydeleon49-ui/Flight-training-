// swift-tools-version:5.3
import PackageDescription
let package = Package(
    name: "tauri-plugin-hfd-pdf",
    platforms: [.iOS(.v13)],
    products: [.library(name: "tauri-plugin-hfd-pdf", type: .static, targets: ["PdfViewerPlugin"])],
    dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
    targets: [
        .target(name: "PdfViewerCore", path: "Core/Sources"),
        .target(name: "PdfViewerPlugin", dependencies: ["Tauri", "PdfViewerCore"], path: "Sources")
    ]
)
