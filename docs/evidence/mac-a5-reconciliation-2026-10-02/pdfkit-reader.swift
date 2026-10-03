// Independent reader check using Apple's PDFKit (ships with macOS; separate from lopdf).
import Foundation
import PDFKit

let pattern = try! NSRegularExpression(pattern: "ID: P(\\d{4})")
for path in CommandLine.arguments.dropFirst() {
    let url = URL(fileURLWithPath: path)
    guard let doc = PDFDocument(url: url) else {
        print("\(url.lastPathComponent): PDFKIT_OPEN_FAILED")
        continue
    }
    var ids: [Int] = []
    var pagesWithoutId = 0
    var pagesWithImage = 0
    for index in 0..<doc.pageCount {
        guard let page = doc.page(at: index) else { pagesWithoutId += 1; continue }
        let text = page.string ?? ""
        let range = NSRange(text.startIndex..., in: text)
        if let match = pattern.firstMatch(in: text, range: range), let r = Range(match.range(at: 1), in: text) {
            ids.append(Int(text[r])!)
        } else {
            pagesWithoutId += 1
        }
        // A drawn image shows up as non-blank thumbnail content near the image box.
        let thumb = page.thumbnail(of: CGSize(width: 60, height: 85), for: .mediaBox)
        if let tiff = thumb.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) {
            let c = rep.colorAt(x: 18, y: 25)
            if let c = c, (c.redComponent + c.greenComponent + c.blueComponent) < 2.9 { pagesWithImage += 1 }
        }
    }
    let first = ids.first ?? -1
    let consecutive = !ids.isEmpty && ids == Array(first..<(first + ids.count))
    print("\(url.lastPathComponent): pages=\(doc.pageCount) ids=\(ids.count) first=\(first) last=\(ids.last ?? -1) consecutive=\(consecutive) pagesWithoutId=\(pagesWithoutId) pagesWithNonWhiteImageSample=\(pagesWithImage)")
}
