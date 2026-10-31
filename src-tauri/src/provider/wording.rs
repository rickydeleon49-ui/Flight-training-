//! Explicit variants for fixed application messages. Dynamic messages are
//! built with the captured provider at their source; user text is never edited.
pub(super) const MESSAGES: &[(&str, &str)] = &[
    ("Gemini study tools currently support PDF, TXT, Markdown, PNG, JPG, and WebP files. Convert this file to PDF first.", "Claude study tools currently support PDF, TXT, Markdown, PNG, JPG, and WebP files. Convert this file to PDF first."),
    ("Gemini was disconnected or its key changed while this PDF was being prepared, so nothing was generated. Try again.", "Claude was disconnected or its key changed while this PDF was being prepared, so nothing was generated. Try again."),
    ("Creating this study aid stopped before Gemini's answer arrived. Nothing was saved; try again.", "Creating this study aid stopped before Claude's answer arrived. Nothing was saved; try again."),
    ("Gemini's answer could not be kept.", "Claude's answer could not be kept."),
    ("Gemini's study guide was incomplete. Try generating it again.", "Claude's study guide was incomplete. Try generating it again."),
    ("Gemini's practice test was incomplete. Try generating it again.", "Claude's practice test was incomplete. Try generating it again."),
    ("Gemini's practice test did not come back usable. Try generating it again.", "Claude's practice test did not come back usable. Try generating it again."),
    ("Gemini did not return a usable answer. Try asking again.", "Claude did not return a usable answer. Try asking again."),
    ("Gemini did not return an answer. Try asking again.", "Claude did not return an answer. Try asking again."),
    ("Gemini's batch was incomplete or too large. The earlier draft is kept.", "Claude's batch was incomplete or too large. The earlier draft is kept."),
    ("Gemini didn't return any flashcards from this file. Nothing was saved — try again, or try a smaller part of the PDF.", "Claude didn't return any flashcards from this file. Nothing was saved — try again, or try a smaller part of the PDF."),
    ("Gemini's answer exceeded the 1 MiB response limit. The earlier draft is kept.", "Claude's answer exceeded the 1 MiB response limit. The earlier draft is kept."),
    ("Gemini's answer was not readable text.", "Claude's answer was not readable text."),
    ("Gemini is already working on another study aid. Wait for it to finish, then try again.", "Claude is already working on another study aid. Wait for it to finish, then try again."),
    ("Her Flight Deck is still finishing restoring a backup, so Gemini cannot be asked for anything new yet. Quit and reopen the app to finish.", "Her Flight Deck is still finishing restoring a backup, so Claude cannot be asked for anything new yet. Quit and reopen the app to finish."),
    ("Gemini's answer was too large to keep, so it was not saved. Try a smaller chapter.", "Claude's answer was too large to keep, so it was not saved. Try a smaller chapter."),
    ("Gemini is writing your study kit…", "Claude is writing your study kit…"),
    ("Gemini is writing your study guide…", "Claude is writing your study guide…"),
];
