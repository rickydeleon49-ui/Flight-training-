# Her Flight Deck privacy policy

Last updated: 2 November 2026

Her Flight Deck is a study companion for student pilots. This policy explains
what the app keeps on your device, what it sends over the internet, and when.
The short version: your records stay on your device, the app has no account
and no analytics, and nothing is sent to an AI provider unless you connect your
own key and choose to send something.

## Who can use the app

- The app is meant for people aged 13 and over.
- The optional AI features need your own Google Gemini or Anthropic Claude API
  key. Google and Anthropic only offer those keys to adults, so you must be 18
  or over to connect one.

## What stays on your device

- Everything you enter (profile, flight log, journal, goals, schedule, notes,
  flashcards, practice results) is saved in a database on your device.
- Study files you import are copied into the app's own folder on your device.
- On a Mac that folder is `~/Library/Application Support/com.herflightdeck.app/`;
  on Windows it is `%APPDATA%\com.herflightdeck.app\`.
- The app keeps a few automatic copies of the database in that folder before
  updates, so a bad update can be undone.
- The app writes a small log file for troubleshooting
  (`~/Library/Logs/com.herflightdeck.app/` on a Mac). It holds fixed messages
  and error types only: never your notes, file names, file contents or keys.
- The app has no account, no sign-in, no ads, no analytics and no tracking. It
  does not check for updates in the background.

## What is sent over the internet, and when

The app only connects to the internet for the features below, and only when you
use them. Like any internet request, each one shows the receiving server your
IP address.

### Google Gemini or Anthropic Claude (optional, your own key)

- Nothing is sent until you connect a key in Settings and choose to use an AI
  feature. When you connect, the app makes one request to check the key works.
- Making a study guide, flashcards, a practice test or a study kit: the app
  first shows a confirmation that names the file. Only after you confirm is
  that one file (or the chapter you chose) sent.
- Ask: when you press Ask, your question, the recent conversation on that
  screen and the study file (or, for a card or practice question, that item
  and the text of the nearby PDF pages) are sent.
- Never sent: your personal notes, flight log, profile and other library files.
  Files filed as administrative documents, or attached to a certificate,
  medical or identification record, are refused outright.
- Requests go straight from your device to Google
  (`generativelanguage.googleapis.com`) or Anthropic (`api.anthropic.com`).
  They do not pass through any server of ours.
- What the provider keeps is set by its own terms. Google keeps an uploaded
  PDF for up to 48 hours so it does not have to be sent again, and on the free
  tier Google may use what you send to improve its products. Anthropic says
  your files are not used for training and are deleted within 30 days. Send
  study material only. The app asks Google to delete its copy sooner when the
  file changes or you disconnect.
- AI answers are saved on your device only after you choose to save them.
  Ask conversations are not saved.

### Airport weather (off until you turn it on)

- When you turn on airport weather and look up an airport, the app sends only
  the four-letter airport code to the US National Weather Service's Aviation
  Weather Center (`aviationweather.gov`).

### FAA handbooks

- When you press download on an FAA handbook, the app downloads that PDF from
  `www.faa.gov`. Nothing about you is sent with the request.

### Links you open

- Links to outside websites (for example FAA pages, Google AI Studio or videos)
  open in your web browser. Those websites' own privacy policies apply.

## Your API key

- Your key is saved as a plain text file in the app's folder on your device
  (`gemini-key` or `claude-key`), readable only by your user account on a Mac.
  It is not encrypted. Anything running as your user account could read it.
- The key passes once from the settings screen to the app's own engine when you
  paste it. After that it is used only by that engine and is never shown again,
  logged, or put in the database.
- Your key is never included in a backup.
- Disconnecting in Settings deletes the key file. You can also revoke the key at
  any time in Google AI Studio or the Anthropic Console.

## Backups and Send to iPhone

- A complete backup is one `.hfdbackup` file with your database and imported
  study files. It is saved where you choose. If you choose a cloud-synced
  folder, that service's terms apply to the copy.
- Send to iPhone (when available) saves a complete backup into your own iCloud
  Drive so your iPhone can open it. Apple's iCloud terms apply to that copy.
- Backups never contain your API key.

## Deleting your data

- Disconnecting a provider deletes its key from your device.
- Uninstalling the app and deleting its folder (listed above) removes
  everything it stored on your device. Copies you saved yourself (backups) stay
  where you put them.
- We hold none of your data, so there is nothing for us to delete or hand over.

## Children

The app is not directed at children under 13. AI features need a provider key,
which you must be 18 or over to hold.

## Changes

If this policy changes, the new version is published at the same address with
a new "Last updated" date.

## Contact

Questions about this policy: open an issue at
<https://github.com/rickydeleon49-ui/Flight-training-/issues>.
