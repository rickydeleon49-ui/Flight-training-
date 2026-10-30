# Her Flight Deck

## Product Specification

**Her Flight Deck** is a warm, personal, highly organized training companion for an aspiring pilot.

It is not simply a to-do list, generic planner, file manager, or aviation reference application.

Its primary purpose is to answer one question:

> **What should I do next to move closer to becoming a pilot?**

The application combines study materials, training goals, flight lessons, schedules, instructor feedback, personal notes, finances, and progress into one private workspace.

## Where she is today

She has not enrolled in flight school. She is studying and flying — lessons and discovery flights — while she decides which school and which training route to take.

The application must therefore be fully useful before an enrolment exists:

- A school, an instructor, and a start date are optional everywhere they appear.
- The roadmap opens on choosing a training route, not on a syllabus already underway.
- School selection, comparison, and cost are ordinary training work, not preamble to it.
- Anything worth writing down has somewhere to go even when it belongs to no lesson, material, or goal yet.

The experience should feel encouraging and beautiful while remaining disciplined about preparation, deadlines, study, lessons, money, and measurable progress.

---

# 1. Product Philosophy

## The Soft Cockpit

The central design principle is a **soft cockpit**.

### Soft

The application should feel:

- Personal
- Feminine
- Calm
- Warm
- Encouraging
- Reflective
- Beautiful
- Comfortable to return to

### Cockpit

The application should also feel:

- Organized
- Dependable
- Focused
- Informative
- Structured
- Precise
- Action-oriented

The interface should balance these two ideas.

It should never feel like a corporate productivity dashboard, but it should also never sacrifice important information for aesthetics.

---

# 2. Emotional Philosophy

Her Flight Deck should support the user without creating guilt.

The application should never shame her for:

- Missing a study session
- Falling behind
- Rescheduling a lesson
- Having difficulty with a topic
- Taking longer than expected to reach a milestone

Instead, the application should help her understand what happened and create a realistic next step.

The tone should communicate:

> **You are capable. Here is the plan. Take the next step.**

However, encouragement must not mean hiding reality.

The application must:

- Clearly display overdue work
- Clearly display deadlines
- Clearly identify incomplete preparation
- Show actual progress rather than fake percentages
- Surface areas that need more review
- Make next actions specific

There should be no guilt-based streak system.

Missing a day should not reset progress.

---

# 3. Core Product Loop

The entire application should support this loop:

**Goal or upcoming lesson**

↓

**Determine what matters next**

↓

**Prepare and study**

↓

**Complete the lesson or activity**

↓

**Record what happened**

↓

**Capture feedback and questions**

↓

**Create the next action**

↓

**Continue progressing**

Every major feature should connect back into this loop.

---

# 4. Next Actions

A **Next Action** should be a first-class concept throughout the application.

A goal can have a next action.

A study document can have a next action.

A lesson can have a next action.

A journal entry can generate a next action.

Instructor feedback can generate a next action.

An overdue task can be rescheduled into a new next action.

Examples:

**Goal**

Improve crosswind landings

**Next Action**

Review crosswind landing notes.

---

**Study Material**

Crosswind Landing Notes.pdf

**Next Action**

Review pages 4–8 before Saturday.

---

**Lesson**

Crosswind Landing Practice

**Next Action**

Ask instructor about rudder timing.

The dashboard should intelligently surface these actions.

The philosophy is:

> **Everything important should eventually tell her what to do next.**

---

# 5. Main Navigation

The primary application navigation should contain:

1. Flight Deck
2. Flight Path
3. Study Library
4. Schedule
5. Flight Journal
6. Questions
7. Notes
8. Finances

Settings and application preferences can be accessible separately.

---

# 6. Flight Deck

The Flight Deck is the application's home screen.

The actual page title should be:

# Today's Flight Plan

The dashboard should be useful within approximately ten seconds of opening the application.

It should immediately communicate:

- What needs to happen today
- What lesson is coming next
- What should be reviewed
- What is overdue
- What milestone is currently being pursued
- How prepared she is for the next lesson
- What her most important next action is

## Today's Flight Plan

Tasks should optionally be organized into:

### Non-Negotiable

Important work that should happen today.

Example:

> Complete weather study session — 30 minutes

### Prepare

Tasks related to upcoming lessons or events.

Example:

> Review crosswind landing notes before Saturday's lesson.

### Life Admin

Administrative responsibilities.

Example:

> Confirm this week's lesson time.

### Stretch Goal

Optional work if she has additional time or energy.

Example:

> Add one question for your instructor.

---

# 7. Dashboard Components

The Flight Deck should include several focused components rather than becoming a giant analytics dashboard.

## Greeting

Example:

> Good morning, Ava.

Below it:

> Private Pilot • Current focus: Landings

The greeting should be warm but concise.

---

## Next Flight

Display the next scheduled flight lesson prominently.

Example:

**Saturday • 10:30 AM**

Crosswind Landings

Preparation:

- Weather review — Complete
- Landing notes — Incomplete
- Instructor question — Incomplete
- Equipment check — Complete

Display preparation as real completed items rather than an arbitrary percentage.

The card can also display:

**Estimated cost: $275**

if an estimated lesson cost has been entered.

---

## Current Milestone

Example:

**Build Landing Confidence**

Completed:

- Normal approaches
- Traffic pattern procedures

Working on:

- Crosswind landings
- Flare timing

Next Action:

> Review instructor notes.

---

## Study Focus

Display one primary topic currently being studied.

Example:

**Current Study Focus**

Weather

Next Action:

> Review fronts and pressure systems.

---

## Needs Attention

Overdue or unresolved items should be clearly visible.

Example:

**Weather Worksheet**

2 days overdue

Actions:

- Complete
- Reschedule

Do not hide overdue work.

Do not use aggressive or guilt-based language.

---

## Encouragement

The dashboard can include one small contextual message.

Examples:

> You made progress this week.

> One focused study session today will prepare you for Saturday.

> Your next lesson is coming up. Two preparation items remain.

Messages should be based on actual application data whenever possible.

Avoid meaningless motivational quotes.

---

# 8. Flight Path

Flight Path represents the user's training journey.

It should visually show where she is going and what she is currently working toward.

Possible milestones include:

- Explore Flight Training
- Begin Ground School
- Start Flight Lessons
- Build Foundational Flight Skills
- Build Confidence in Key Topics
- Prepare for Written Exam
- Prepare for Practical Test
- Complete Private Pilot Training
- Future Ratings
- Career Goals

The system should remain flexible because training requirements differ by location, school, instructor, and certificate.

The application should not present itself as an authoritative replacement for official aviation requirements.

---

# 9. Evidence-Based Progress

Avoid arbitrary progress indicators such as:

> Private Pilot — 42%

unless that percentage is calculated from clearly defined user-created requirements.

Instead, progress should be supported by evidence.

Example:

## Crosswind Landings

**Status:** In progress

Evidence:

- 3 lessons recorded
- 2 instructor notes
- 2 study materials reviewed
- Confidence: 3/5
- Last practiced: September 1

This provides meaningful context without pretending the software knows whether the user has officially mastered a skill.

---

# 10. Goals

Users should be able to create goals.

Each goal can contain:

- Title
- Description
- Milestone
- Status
- Target date
- Priority
- Checklist
- Notes
- Related study materials
- Related lessons
- Related journal entries
- Next action

Possible statuses:

- Not Started
- In progress
- Comfortable
- Completed
- Paused

Goals should appear throughout the application when relevant.

---

# 11. Study Library

The Study Library is one of the most important components of the first release.

It should function like a beautifully organized personal training binder rather than a generic file explorer.

Users should be able to upload and organize real documents.

Supported initial materials can include:

- PDFs
- Instructor handouts
- Study guides
- Lesson notes
- Checklists
- Worksheets
- Screenshots
- Reference files
- Personal documents
- Administrative documents

---

# 12. Study Material Metadata

Every study item should support:

## Title

A clear human-readable title.

## Material Type

Examples:

- Study Guide
- Lesson Notes
- Checklist
- Instructor Handout
- Personal Note
- Worksheet
- Admin Document
- Reference

## Topic

Examples:

- Weather
- Navigation
- Regulations
- Communications
- Aerodynamics
- Aircraft Systems
- Flight Planning
- Airports
- Performance
- Emergency Procedures

Topics should be extensible.

## Training Goal

Optional connection to a goal or milestone.

## Related Lesson

Optional connection to a scheduled or completed lesson.

## Review Status

- Review again
- Studying
- Confident
- Reference Only

## Priority

- Next Up
- Important
- Later

## Tags

Flexible user-created labels.

## Personal Notes

Notes attached directly to the material.

## Questions

Questions generated while studying the material.

## Next Action

A specific action related to the material.

Example:

> Review sections 3–5 before Saturday.

---

# 13. Document Workflow

The document workflow should be:

**Upload Material**

↓

**Give it a clear title**

↓

**Add labels**

↓

**Attach it to a goal or lesson**

↓

**Add personal notes/questions**

↓

**Choose review status**

↓

**Create next action**

↓

**Surface it automatically when relevant**

Example:

**Weather Patterns Study Guide.pdf**

Type: Study Guide

Topic: Weather

Goal: Private Pilot Preparation

Review Status: Studying

Priority: Next Up

Related Lesson: Saturday's Flight Lesson

Next Action:

> Review before Saturday's lesson.

---

# 14. Study Library Views

The Study Library should support useful filters.

Examples:

- Next Up
- Studying
- Review again
- Confident
- Reference Only

Users should also be able to filter by:

- Topic
- Material Type
- Goal
- Lesson
- Priority
- Tag

Search should initially search metadata and titles.

Full document text search can be added later.

---

# 15. Document Detail Workspace

Opening a study item should display more than just the file.

The document workspace should include:

- Document preview when supported
- Title
- Material type
- Topic
- Review status
- Priority
- Related goal
- Related lesson
- Next action
- Personal notes
- Questions
- Tags
- Date uploaded
- Last reviewed

The workspace should make it easy to move from reading into taking action.

---

# 16. Flight Journal

The Flight Journal creates a useful history of actual training.

After a lesson, the user should be able to create a structured debrief.

Fields should include:

## Today's Mission

What was the primary purpose of the lesson?

## What Did You Practice?

Free-form notes.

## What Went Well?

Positive observations.

## What Was Difficult?

Areas that need additional attention.

## Instructor Feedback

Important feedback received from the instructor.

## Questions for Next Time

Questions to remember.

## Confidence

Simple 1–5 self-assessment.

Confidence is reflective information, not an official proficiency rating.

## Next Action

What should happen because of this lesson?

Example:

> Review flare timing.

After saving a journal entry, the application can ask:

> Add "Review flare timing" to your Flight Plan?

This turns reflection into action.

---

# 17. Journal History

Users should be able to browse previous lessons.

Entries should display:

- Date
- Lesson title
- Mission
- Topics practiced
- Confidence
- Instructor feedback
- Questions
- Next action
- Related goals
- Related documents

Over time this becomes a personal record of training progress.

---

# 18. Schedule

The Schedule should initially focus on training rather than trying to replace a full calendar application.

Users should be able to schedule:

- Flight lessons
- Study sessions
- Ground school
- Instructor meetings
- Written tests
- Practical tests
- Medical appointments
- Administrative deadlines
- Personal commitments affecting training

---

# 19. Schedule Events

Events should support:

- Title
- Event type
- Date
- Start time
- End time
- Location
- Instructor
- Notes
- Related goal
- Related documents
- Preparation checklist
- Estimated cost
- Actual cost
- Status

Possible statuses:

- Scheduled
- Completed
- Cancelled
- Rescheduled

---

# 20. Lesson Preparation

A scheduled flight lesson should support preparation items.

Example:

## Crosswind Landing Lesson

Saturday • 10:30 AM

Preparation:

- Weather review
- Review landing notes
- Write instructor question
- Equipment check

Related Materials:

- Crosswind Landing Notes.pdf
- Wind Components Worksheet.pdf

Estimated Cost:

$275

The Flight Deck should automatically surface incomplete preparation as the lesson approaches.

---

# 21. Questions

The Questions section is a simple running collection of things the user does not want to forget.

Questions can originate from:

- Study materials
- Flight lessons
- Journal entries
- Goals
- Personal thoughts

Each question can contain:

- Question
- Topic
- Related lesson
- Related study material
- Date created
- Status
- Answer/notes

Statuses:

- To Ask
- Asked
- Answered
- Revisit

The Flight Deck can surface unanswered questions before an instructor lesson.

---

# 21a. Notes

Every other place a thought can be typed asks what it belongs to first: which lesson, which material, which goal, which topic.

That is the right shape for a debrief and the wrong shape for a phone number, a school worth calling, or a sentence she wants to keep.

**Notes** is the section that asks nothing.

A note contains:

- Title, which may be left blank
- The text itself
- Whether it is pinned
- When it was written, and when it was last changed

Behaviour:

- A note needs text and nothing else.
- With no title, the note is listed under the first line she typed.
- Pinned notes are read first, then the most recently changed.
- Notes are searchable by title and text, and appear in Quick Find.
- Line breaks are preserved exactly as written.
- Deleting a note is undoable for the same window as everything else.

Notes should never be categorized, scored, analysed, or turned into a prompt. Adding a required field to a note would remove the reason it exists.

---

# 22. Feedback

Instructor feedback should be preserved.

Feedback can be attached to:

- Lessons
- Journal entries
- Goals
- Topics

The user should be able to revisit feedback over time.

Future versions can identify recurring feedback themes.

The first version should focus on reliable storage and organization.

---

# 23. Training Finances

Her Flight Deck should include a dedicated **Finances** section focused specifically on flight training.

It should not attempt to become a general personal finance application.

The Finances section should answer:

> **How much money have I set aside for training?**

> **How much have I spent?**

> **What expenses are coming next?**

---

# 24. Flight Fund

The user should be able to record money specifically reserved for training.

Example:

## Flight Fund

**Available:** $2,850

**Total Added:** $6,270

**Total Spent:** $3,420

Users should be able to:

- Add funds
- Record expenses
- Edit transactions
- Delete transactions
- Add transaction notes

The current available balance should be calculated from transactions rather than manually maintained whenever possible.

---

# 25. Financial Transactions

Two primary transaction types:

## Add Funds

Examples:

- Added $500 to training fund
- Gift toward flight training
- Saved paycheck money
- Other contribution

## Expense

Examples:

- Flight lesson
- Aircraft rental
- Instructor fee
- Ground school
- Written exam
- Practical test
- Medical exam
- Books
- Study materials
- Headset
- Equipment
- Applications
- Administrative fees
- Travel
- Other

Transactions should contain:

- Amount
- Date
- Type
- Category
- Description
- Notes
- Related lesson
- Related goal
- Optional receipt/reference later

---

# 26. Financial Dashboard

The Finances screen should show:

## Available for Training

Current Flight Fund balance.

## Total Spent

Lifetime recorded training expenses.

## Total Added

Total amount contributed to the Flight Fund.

## Upcoming Expenses

Estimated costs associated with scheduled events.

Example:

- Saturday Flight Lesson — ~$275
- Ground School — $150
- Medical Exam — ~$175

## Recent Spending

Example:

- Sep 3 — Flight Lesson — $265
- Aug 29 — Study Materials — $42
- Aug 26 — Flight Lesson — $280

Actions:

**+ Add Funds**

**+ Add Expense**

---

# 27. Financial Goals

Users should optionally be able to create Flight Fund targets.

Example:

**Flight Fund Goal**

$2,850 / $5,000

Progress should be based directly on recorded money.

Financial goals can optionally relate to milestones.

Example:

> Save $3,000 for the next phase of training.

---

# 28. Training Cost Insights

As enough data accumulates, the application can calculate useful statistics.

Examples:

- Total spent on training
- Total spent on flight lessons
- Total spent on study materials
- Average lesson cost
- Spending this month
- Average monthly training cost
- Number of paid lessons
- Upcoming estimated training costs

These calculations should use actual transaction data.

Do not create misleading projections without explaining how they were calculated.

---

# 29. Connecting Finances to Training

Finances should not exist in isolation.

A scheduled lesson can have:

**Estimated Cost:** $275

After completing the lesson:

**Actual Cost:** $265

The user can then choose to record the actual cost as a financial transaction.

This connects:

Schedule → Lesson → Journal → Finances

A milestone can eventually contain estimated costs.

The Flight Deck can surface financial information when useful without turning the dashboard into a banking application.

---

# 30. Visual Direction

The interface should feel feminine, premium, warm, calm, and polished without becoming childish.

Avoid excessive pink.

Suggested palette:

| Purpose | Color |
|---|---|
| Background | Warm Ivory `#FAF7F4` |
| Primary Surface | White `#FFFFFF` |
| Primary Text | Deep Navy `#17233C` |
| Secondary Text | Muted Navy `#596276` |
| Primary Accent | Berry `#A84C6B` |
| Secondary Accent | Dusty Rose `#DFA7B8` |
| Goals/Study | Lavender `#B9ADDF` |
| Flight/Schedule | Sky Blue `#8EBFDA` |
| Complete/Confident | Soft Mint `#AAD4C4` |

Warnings, deadlines, and overdue work must have sufficient contrast.

Use a muted but unmistakable red for overdue items.

---

# 31. Visual Motifs

Possible aviation-inspired visual details:

- Thin route lines
- Small waypoint markers
- Subtle cloud textures
- Altitude-inspired progress markers
- Boarding-pass-inspired cards
- Minimal aviation icons
- Small runway/heading motifs

These should be subtle.

Do not turn every interface element into aviation terminology.

A button should say:

> Upload File

not:

> Load Cargo

Usability is more important than theme.

---

# 32. Typography

Use an elegant display typeface for major headings and emotionally important moments.

Examples:

> Today's Flight Plan

> Your Flight Path

Pair it with a highly readable sans-serif font for:

- Tasks
- Documents
- Dates
- Schedules
- Financial information
- Forms
- Navigation

The application should remain highly readable.

---

# 33. Component Style

Use:

- Generous whitespace
- Large but controlled border radii
- Thin borders
- Very subtle shadows
- Clear hierarchy
- Comfortable spacing
- Strong typography
- Purposeful accent colors

Avoid:

- Excessive gradients
- Glassmorphism everywhere
- Neon colors
- Dense corporate dashboards
- Excessive animation
- Cartoon aviation imagery
- Generic AI-dashboard aesthetics

Animation should be subtle and functional.

---

# 34. Empty States

Empty states should feel inviting and useful.

Example:

## Study Library

> Your training library is ready.

> Add your first study guide, lesson notes, or instructor handout.

**Upload Material**

Instead of:

> No data found.

---

# 35. Overdue Work

Overdue work should be visible without creating shame.

Example:

## Needs Attention

**Weather Worksheet**

2 days overdue

Actions:

- Complete
- Reschedule

Possible supporting copy:

> This didn't get finished. Choose a realistic new time.

Do not:

- Remove progress
- Use negative streaks
- Display failure messages
- Punish the user

---

# 36. Privacy

This is initially a private personal application.

Personal materials should never be committed to a public GitHub repository.

This includes:

- PDFs
- Instructor handouts
- School materials
- Journal entries
- Personal notes
- Financial information
- Training records

GitHub should contain source code only.

---

# 37. Desktop Architecture

The first version should be desktop-first.

Preferred architecture:

**React**

**TypeScript**

**Tauri**

**SQLite**

The application should store documents in a private local application data directory.

SQLite should store structured application data such as:

- Document metadata
- Goals
- Next actions
- Journal entries
- Schedule events
- Questions
- Financial transactions
- Application settings

---

# 38. Data Architecture

Avoid directly coupling every UI component to SQLite.

Use repository/service abstractions.

Examples:

- DocumentRepository
- GoalRepository
- ActionRepository
- JournalRepository
- ScheduleRepository
- QuestionRepository
- FinanceRepository

This allows the storage implementation to change later.

For example:

**LocalDocumentRepository**

could eventually become:

**CloudDocumentRepository**

without requiring the entire interface to be rewritten.

---

# 39. Local File Storage

Uploaded documents should be copied or managed inside the application's private data directory.

The database should store metadata and references to those files.

Do not store personal documents in the source repository.

The application should handle missing files gracefully.

---

# 40. Future Hosted Version

A future web/hosted version could add:

- User authentication
- Private cloud storage
- Cloud database
- Multi-device synchronization
- Secure backups

Do not use GitHub Pages alone for a hosted version requiring private uploads and persistent personal data.

---

# 41. Safety and Authority

Her Flight Deck is an organizational and study companion.

It should not claim to replace:

- Flight instructors
- Flight schools
- Aviation authorities
- Official regulations
- Aircraft documentation
- Safety procedures
- Required training

The application organizes material and information provided by the user.

Where appropriate, language should make this distinction clear.

---

# 42. First Release Scope

The first release should focus on doing a small number of things extremely well.

## Required

### Flight Deck

A beautiful and functional Today's Flight Plan dashboard.

### Study Library

Real local document uploads with useful metadata.

### Goals / Flight Path

Goals, milestones, statuses, evidence, and next actions.

### Next Actions

A shared action system connecting the application.

### Schedule

Simple training events and lesson preparation.

### Flight Journal

Structured post-lesson debriefs.

### Questions

Questions to ask and revisit.

### Notes

Free writing that belongs to nothing else.

### Finances

Flight Fund contributions, expenses, upcoming costs, and training-spending history.

---

# 43. Features Not Required for V1

Do not allow these to distract from the foundation:

- AI assistant
- AI document summaries
- Automatic FAA requirement tracking
- Cloud synchronization
- Instructor accounts
- Social features
- Calendar synchronization
- Advanced PDF annotation
- Flashcards
- Practice exam engine
- Push notifications
- Complex financial forecasting
- Bank account connections
- OCR
- Full-text PDF indexing

These can be added after the core application is trustworthy.

---

# 44. Future Features

Possible later additions:

## Documents

- Integrated PDF viewer
- Highlighting
- Annotations
- Full-text search

## Studying

- Flashcards
- Study timer
- Practice question tracking
- Topic review history

## Training

- Instructor feedback trends
- Confidence history
- Training summaries
- Exportable progress reports

## Calendar

- Google Calendar synchronization
- Apple Calendar synchronization
- Reminders

## Finances

- Spending charts
- Cost projections
- Training budget planning
- Receipt attachments
- Exportable expense reports

## AI

AI functionality should only use material the user explicitly chooses.

Possible capabilities:

- Summarize selected study material
- Generate study questions
- Explain selected material
- Help organize notes
- Suggest study plans
- Identify recurring instructor feedback

AI should not present itself as an authoritative replacement for flight instruction or official aviation guidance.

---

# 45. Suggested Core Data Relationships

The application's objects should be connected rather than isolated.

A conceptual relationship:

```text
Milestone
    ↓
Goal
    ↓
Next Action
    ↕
Study Material
    ↕
Schedule Event / Lesson
    ↕
Journal Entry
    ↕
Question / Feedback
    ↕
Financial Transaction
```

Relationships should be optional where appropriate.

A document does not need a lesson.

A transaction does not need a goal.

A note relates to nothing at all, deliberately.

But when relationships exist, the application should use them to provide better context.

---

# 46. Important Product Rules

1. Always prioritize the next useful action.

2. Do not create fake progress.

3. Do not shame the user for falling behind.

4. Do not hide overdue responsibilities.

5. Keep the interface warm without sacrificing clarity.

6. Keep aviation styling subtle and functional.

7. Preserve user privacy.

8. Keep personal documents out of GitHub.

9. Connect information across the application instead of creating isolated feature silos.

10. Prefer useful simplicity over feature quantity.

11. Treat instructor and official aviation information as authoritative over the application.

12. Financial tracking is for training planning, not general banking.

13. Make the application feel like a personal training companion rather than enterprise software.

---

# 47. Product Identity

## Name

**Her Flight Deck**

## Primary Home Screen

**Today's Flight Plan**

## Product Description

> **A personal flight-training companion that keeps your study, lessons, goals, notes, finances, and next steps organized in one place.**

## Core Promise

When she opens Her Flight Deck, she should understand:

> **Where am I going?**

> **What am I working on?**

> **What is coming up?**

> **Am I prepared?**

> **What have I learned?**

> **What is my training costing?**

> **What should I do next?**

If the application consistently answers those questions, it is accomplishing its purpose.