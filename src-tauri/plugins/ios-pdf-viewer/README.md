# Native PDF proof

First-party iOS-only Tauri bridge using Apple's PDFKit. It exposes no frontend
plugin commands. The app's `open_ios_pdf` command accepts a material ID and an
optional positive, 1-based physical page; it resolves the library row and reads
through the shared bounded document reader before creating a private snapshot.
Desktop calls return `Only on iPhone/iPad`. Product routing is a later round.

The internal native call stays pending through the presentation. Done resolves
it after dismissal, releasing the Rust snapshot; load/presentation/page errors
reject it and also release the snapshot. A process terminated while reading may
leave a snapshot; the next native open clears only this viewer's sandbox-local
temporary area. No source document is edited or deleted.

`ios/Core` is a standalone Apple-SDK-only Swift test package. Its test helper
creates numbered multipage PDFs locally and removes them afterward. It tests
physical page mapping, invalid pages, missing/corrupt/locked documents and the
presentation state machine. Run `swift test --package-path ios/Core` from this
directory with a matching Xcode SDK and writable Swift/Clang caches.

Host core tests do not establish UIKit presentation, layout, visible PDF pixels,
pinch, rotation, dismissal or reopen behavior. These still need simulator and
physical-device acceptance. No generated Xcode project is source of truth.
