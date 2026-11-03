import Foundation
import PDFKit

public enum PdfOpenError: String, Error {
    case missing = "That PDF is missing. Please import it again."
    case corrupt = "That PDF could not be read. Try importing another copy."
    case locked = "That PDF is locked. Import an unlocked copy to read it here."
    case page = "That physical page is outside this PDF. Choose a page starting at 1."
}

public enum PdfDocumentLoader {
    public static func load(url: URL) throws -> PDFDocument {
        guard url.isFileURL, FileManager.default.fileExists(atPath: url.path) else {
            throw PdfOpenError.missing
        }
        guard let document = PDFDocument(url: url) else { throw PdfOpenError.corrupt }
        guard !document.isLocked else { throw PdfOpenError.locked }
        guard document.pageCount > 0 else { throw PdfOpenError.corrupt }
        return document
    }

    public static func page(_ number: UInt32, in document: PDFDocument) throws -> PDFPage {
        guard number > 0, UInt64(number) <= UInt64(document.pageCount),
              let page = document.page(at: Int(number) - 1) else { throw PdfOpenError.page }
        return page
    }
}

/// Called exclusively on the main thread by the UIKit adapter.
public final class PdfPresentationState {
    private enum State { case idle, presented, closing }
    private var state = State.idle
    public init() {}
    public func begin() -> Bool {
        guard state == .idle else { return false }
        state = .presented
        return true
    }
    public func beginClosing() -> Bool {
        guard state == .presented else { return false }
        state = .closing
        return true
    }
    public func finish() { state = .idle }
}

/// Continuous layout can show a short last page without making it currentPage.
public enum PdfPageSelection {
    public static func isDisplayed(_ page: PDFPage, current: PDFPage?, visible: [PDFPage]) -> Bool {
        current === page || visible.contains { $0 === page }
    }
}
