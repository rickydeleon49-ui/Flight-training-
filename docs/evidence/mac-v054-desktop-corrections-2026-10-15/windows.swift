// Lists window-server windows for one PID (or all owners matching a name), independent of accessibility.
import CoreGraphics
import Foundation
let args = CommandLine.arguments
let wantPid = args.count > 1 ? Int(args[1]) : nil
let opts: CGWindowListOption = [.optionAll]
let list = (CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]]) ?? []
var out: [[String: Any]] = []
for w in list {
  let pid = w[kCGWindowOwnerPID as String] as? Int ?? -1
  let owner = w[kCGWindowOwnerName as String] as? String ?? ""
  if let p = wantPid { if pid != p { continue } } else if !owner.lowercased().contains("her flight") && !owner.contains("her-flight") { continue }
  let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
  out.append(["pid": pid, "owner": owner, "layer": w[kCGWindowLayer as String] ?? -1, "onscreen": w[kCGWindowIsOnscreen as String] ?? false,
              "alpha": w[kCGWindowAlpha as String] ?? -1, "bounds": b, "number": w[kCGWindowNumber as String] ?? -1])
}
let data = try! JSONSerialization.data(withJSONObject: ["observedAt": ISO8601DateFormatter().string(from: Date()), "pid": wantPid as Any, "windows": out], options: [.prettyPrinted, .sortedKeys])
print(String(data: data, encoding: .utf8)!)
