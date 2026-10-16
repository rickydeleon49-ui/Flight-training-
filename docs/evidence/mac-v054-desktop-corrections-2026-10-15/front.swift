import AppKit
let f = NSWorkspace.shared.frontmostApplication
print("{\"frontPid\":\(f?.processIdentifier ?? -1),\"frontName\":\"\(f?.localizedName ?? "")\",\"frontPath\":\"\(f?.bundleURL?.path ?? "")\"}")
