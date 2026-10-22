# Her Flight Deck 0.5.9: what's new

Written for her. Paste the "What's new" part into the GitHub release draft above the download table the release workflow writes.

## What's new

Everything from 0.5.8 is here, along with a fix so the Mac app opens properly. Your study tools and homework are ready when you are.

**Homework.** The Study Library has a new Homework section for anything you want to prepare, whether you set it yourself or an instructor gives it to you.
- **Activities:** an assignment can hold readings (with page ranges), flashcards, a practice quiz, a reflection, questions to bring to your instructor, and checklist items. School, instructor, due date and lesson are all optional.
- **It completes itself:** card and quiz activities finish themselves when you review the cards or finish the quiz. Your quiz score is shown separately; there's no pass mark.
- **Daily plan:** homework shows up there with a plain reason, like "Homework due today" or "Preparation for [lesson]". **Open homework** takes you straight to it.
- **Search** finds your homework too.

**Make a study kit from your PDFs, with no internet and no AI.** On a PDF in your Study Library, the app can now build a study kit right on your Mac:
- glossary and definition cards;
- fill-in-the-blank cards for key terms and numbers;
- an outline guide.

Every item remembers which page it came from. Nothing is sent anywhere.

**Search inside your documents.** Search now looks inside your PDFs' text and through your saved guides, cards and questions, even offline. Results point to the page.

**Study material you write yourself.** Write your own summaries, flashcards and practice questions for any material, and edit them any time. Your edits are kept even if a guide is generated again later.

**Longer documents are more reliable.** Study guides are made section by section and pick up where they left off if the connection drops. Slow uploads get more time, and "Try again" reuses the file you already uploaded instead of sending it again.

**Clearer screens.**
- The daily plan speaks plainly ("About 10 of your 20 minutes planned").
- The Flight Deck no longer contradicts itself.
- Dates read like "Oct 20".
- You can answer reflection and question activities right on the homework page.

## Your data

- Your training data carries over. The app copies your database before it updates, as always.
- This version adds new storage for homework and for where each study-kit item came from. Nothing existing is changed or removed.
- Backups made with 0.5.9 include your homework.

## Good to know

- **Memory:** making a study kit from a large PDF uses memory while it works, capped at 512 MB. On a Mac with 8 GB, the first time you try it, keep your usual apps open and see how it feels. If it's slow, say so; the cap can be lowered in a follow-up.
- **Windows:** distribution stays on 0.5.1 pending a separate security review.
- **Development tools:** this release includes a security update to the app's development tooling (Vite 7.3.7). It doesn't change how the app behaves.

## For the owner

- **Base:** the 0.5.8 feature release, with the Mac bundle signing fix, version 0.5.9 (0.5.2, 0.5.6 and 0.5.8 are permanently retired; never reuse them).
- **Built with** `HFD_OFFLINE_EXTRACTION=1` (set by the release workflow), so the PDF kit and search are on.
- **Before publishing the draft:** download the exact draft `.dmg` and confirm its SHA-256 matches the published checksum. On its app, run `codesign --verify --deep --strict` and require success; confirm version **0.5.9** and architecture **arm64**.
- **First launch on a real Apple silicon Mac:** after the checksum matches, if macOS says it cannot verify the developer, help her open the exact draft app through **System Settings → Privacy & Security → Open Anyway**. Confirm it opens and her existing data is there before publishing. Then try one homework item and one small PDF study kit.
