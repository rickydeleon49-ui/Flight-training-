import Foundation
import PDFKit
import PdfViewerCore
import SwiftRs
import Tauri
import UIKit

private struct OpenOptions: Decodable {
    let path: String
    let title: String
    let physicalPage: UInt32
}

// A single pending presentation owns its document and completion until dismissal.
final class PdfViewerPlugin: Plugin {
    private var active: UINavigationController?
    private let state = PdfPresentationState()

    @objc public func openPdf(_ invoke: Invoke) throws {
        let options = try invoke.parseArgs(OpenOptions.self)
        DispatchQueue.main.async { [self] in
            guard state.begin() else {
                invoke.reject("A PDF is already open. Tap Done before opening another.")
                return
            }
            guard let presenter = manager.viewController,
                  presenter.viewIfLoaded?.window != nil,
                  presenter.presentedViewController == nil,
                  !presenter.isBeingDismissed else {
                state.finish()
                invoke.reject("Close the current window, then try opening the PDF again.")
                return
            }
            do {
                let document = try PdfDocumentLoader.load(url: URL(fileURLWithPath: options.path))
                let page = try PdfDocumentLoader.page(options.physicalPage, in: document)
                let viewer = PdfController(document: document, page: page)
                viewer.title = options.title
                let navigation = UINavigationController(rootViewController: viewer)
                // Done is the only dismissal path, so cleanup cannot race an interactive swipe.
                navigation.isModalInPresentation = true
                var pageSelected = false
                viewer.finished = { [weak self] in
                    guard self?.state.beginClosing() == true else { return }
                    pageSelected = pageSelected || viewer.initialPageIsVisible()
                    navigation.dismiss(animated: true) {
                        viewer.pdfView.document = nil
                        viewer.finished = nil
                        self?.active = nil
                        self?.state.finish()
                        if pageSelected {
                            invoke.resolve()
                        } else {
                            invoke.reject("That physical page could not be displayed. Please try again.")
                        }
                    }
                }
                active = navigation
                presenter.present(navigation, animated: true) {
                    guard navigation.presentingViewController != nil else {
                        viewer.finished = nil
                        self.active = nil
                        self.state.finish()
                        invoke.reject("The PDF viewer could not open. Please try again.")
                        return
                    }
                    // PDFView needs its final viewport before selecting the physical page.
                    viewer.view.layoutIfNeeded()
                    pageSelected = viewer.selectInitialPage()
                    // Keep a readable viewer open even if PDFKit has not settled its viewport.
                    // Done checks again; a failed jump never acknowledges a page save.
                }
            } catch let error as PdfOpenError {
                state.finish()
                invoke.reject(error.rawValue)
            } catch {
                state.finish()
                invoke.reject("That PDF could not be opened. Please try again.")
            }
        }
    }
}

private final class PdfController: UIViewController {
    let pdfView = PDFView()
    private let initialPage: PDFPage
    var finished: (() -> Void)?

    init(document: PDFDocument, page: PDFPage) {
        initialPage = page
        super.init(nibName: nil, bundle: nil)
        pdfView.document = document
    }
    required init?(coder: NSCoder) { fatalError("Not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        pdfView.translatesAutoresizingMaskIntoConstraints = false
        pdfView.autoScales = true
        pdfView.displayMode = .singlePageContinuous
        pdfView.displayDirection = .vertical
        view.addSubview(pdfView)
        NSLayoutConstraint.activate([
            pdfView.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            pdfView.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            pdfView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            pdfView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
        ])
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .done, target: self, action: #selector(done))
    }

    func selectInitialPage() -> Bool {
        pdfView.layoutDocumentView()
        pdfView.go(to: initialPage)
        return initialPageIsVisible()
    }

    func initialPageIsVisible() -> Bool {
        PdfPageSelection.isDisplayed(initialPage, current: pdfView.currentPage, visible: pdfView.visiblePages)
    }

    @objc private func done() {
        finished?()
    }
}

@_cdecl("init_plugin_hfd_pdf")
func initPlugin() -> Plugin { PdfViewerPlugin() }
