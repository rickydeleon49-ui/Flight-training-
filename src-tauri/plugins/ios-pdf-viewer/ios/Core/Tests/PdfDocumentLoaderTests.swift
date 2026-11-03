import XCTest
import PDFKit
import CoreGraphics
import CoreText

@testable import PdfViewerCore

final class PdfDocumentLoaderTests: XCTestCase {
    // Synthetic text/vector PDF: no imported document or font assets.
    private func numberedPDF(at url: URL, pages: Int = 5) throws {
        var bounds = CGRect(x: 0, y: 0, width: 400, height: 600)
        let context = try XCTUnwrap(CGContext(url as CFURL, mediaBox: &bounds, nil))
        for number in 1...pages {
            context.beginPDFPage(nil)
            let text = NSAttributedString(string: "Synthetic physical page \(number)", attributes: [
                .font: CTFontCreateWithName("Helvetica" as CFString, 24, nil)
            ])
            context.textPosition = CGPoint(x: 30, y: 300)
            CTLineDraw(CTLineCreateWithAttributedString(text), context)
            context.endPDFPage()
        }
        context.closePDF()
    }

    func testVisibleInitialPageNeedNotBeCurrentPage() {
        let first = PDFPage()
        let shortLast = PDFPage()
        XCTAssertTrue(PdfPageSelection.isDisplayed(shortLast, current: first, visible: [first, shortLast]))
        XCTAssertTrue(PdfPageSelection.isDisplayed(first, current: nil, visible: [first]))
        XCTAssertTrue(PdfPageSelection.isDisplayed(first, current: first, visible: []))
        XCTAssertFalse(PdfPageSelection.isDisplayed(shortLast, current: first, visible: [first]))
    }

    func testPresentationSerializesOpenDismissAndReopen() {
        let state = PdfPresentationState()
        XCTAssertFalse(state.beginClosing())
        XCTAssertTrue(state.begin())
        XCTAssertFalse(state.begin())
        XCTAssertTrue(state.beginClosing())
        XCTAssertFalse(state.beginClosing())
        XCTAssertFalse(state.begin())
        state.finish()
        XCTAssertTrue(state.begin())
        state.finish() // A failed presentation also releases the slot.
        XCTAssertTrue(state.begin())
    }

    func testNumberedPagesAndPhysicalIndices() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("numbered.pdf")
        try numberedPDF(at: url)
        let document = try PdfDocumentLoader.load(url: url)
        XCTAssertEqual(document.pageCount, 5)
        for number: UInt32 in [1, 3, 5] {
            let page = try PdfDocumentLoader.page(number, in: document)
            XCTAssertEqual(document.index(for: page), Int(number) - 1)
            XCTAssertTrue(page.string?.contains("physical page \(number)") == true)
        }
        for number: UInt32 in [0, 6, UInt32.max] {
            XCTAssertThrowsError(try PdfDocumentLoader.page(number, in: document)) {
                XCTAssertEqual($0 as? PdfOpenError, .page)
            }
        }
    }

    func testMissingCorruptAndLockedHavePlainErrors() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".pdf")
        defer { try? FileManager.default.removeItem(at: url) }
        XCTAssertThrowsError(try PdfDocumentLoader.load(url: url)) { XCTAssertEqual($0 as? PdfOpenError, .missing) }
        try Data("synthetic corrupt PDF".utf8).write(to: url)
        XCTAssertThrowsError(try PdfDocumentLoader.load(url: url)) { XCTAssertEqual($0 as? PdfOpenError, .corrupt) }
        try numberedPDF(at: url, pages: 1)
        let document = try PdfDocumentLoader.load(url: url)
        XCTAssertTrue(document.write(to: url, withOptions: [.ownerPasswordOption: "synthetic-owner", .userPasswordOption: "synthetic-reader"]))
        XCTAssertThrowsError(try PdfDocumentLoader.load(url: url)) { XCTAssertEqual($0 as? PdfOpenError, .locked) }
    }
}
