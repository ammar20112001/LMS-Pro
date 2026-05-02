# LMS-Pro — Claude Design Prompt

Design a complete web application called **LMS-Pro** for a university student at Virtual University of Pakistan (VU). The student has multiple concurrent courses with assignments, quizzes, and discussion boards all running simultaneously. The application automatically scrapes the university's LMS in the background so the student never has to open the university website. Everything the student needs to track, study, and submit is in this single app.

---

## What the app does

The app connects to the VU LMS (the university's online learning platform) via a background scraper and pulls all course data into a local database. It then presents that data through a clean interface where the student can:

- See everything due across all courses in one place
- Know instantly what is submitted, what is overdue, and what is coming up
- Track their lecture progress course by course
- Download and view assignment files posted by professors
- Get email alerts before deadlines hit
- Practice for quizzes using AI-generated questions from lecture material
- Read AI-generated notes from lecture transcriptions instead of watching full videos
- Submit assignments through the app (uploading their own work)
- Chat with an AI tutor that knows the course content

---

## Pages and screens needed

### 1. Dashboard (home)

The main view the student sees when they open the app. Shows:

- A header with the app name, current semester label, and a "Sync Now" button that triggers a fresh scrape of the LMS. The button shows a loading/syncing state while running and shows when the last sync completed.
- Summary stat cards showing counts of pending assignments, upcoming quizzes, and open GDBs (graded discussion boards) across all courses.
- A deadline feed showing every item due in the next 14 days across all courses sorted by due date. Each item shows: course code, item type (assignment / quiz / GDB), title, how much time is left, total marks, and submission status (open / submitted / expired).
- Items that are past due but still open on the LMS (the professor extended or hasn't closed them) should still appear with a visual indicator.
- Submitted items should appear differently from pending ones.
- Clicking an item expands it or opens a detail view.
- A courses section listing all enrolled courses. Clicking a course opens the course detail page.
- A sync history table showing the last few sync runs with timestamps, status, and how many items were added or updated.

### 2. Course detail page

Opened when the student clicks a course from the dashboard. Shows:

- Course name and code.
- A progress indicator showing how far through the lecture content the student is (e.g. 12 of 45 lectures completed) with a visual progress bar.
- A list of all lectures for the course in order. Each lecture row shows: lecture number, lecture title, content type icons (has video, has reading material, has handout), and whether the student has marked it as done. Clicking a lecture row marks the student's progress up to that point.
- All pending deadlines for this specific course (assignments, quizzes, GDBs) shown at the top.
- A tab or section for each item type: Assignments, Quizzes, GDBs.

### 3. Assignment detail

Opened when the student clicks a specific assignment. Shows:

- Assignment title, course, due date, total marks, and status.
- The assignment question/instructions file posted by the professor with a button to view or download it. The file opens without requiring the student to log into the university website.
- A submission area where the student can upload their completed assignment file and submit it directly through this app (the app handles the LMS submission in the background).
- Submission confirmation and status once submitted.
- The student's submitted file if they have already submitted.

### 4. Quiz detail

Opened when the student clicks a specific quiz. Shows:

- Quiz title, course, start and end dates/times, total marks, and status (upcoming / open now / closed / submitted).
- If the quiz is open: a button to open the quiz on the LMS (since quizzes are time-limited and must be taken there).
- A practice mode section: AI-generated practice questions based on the topics covered in lectures up to that quiz. The student can answer them and get instant feedback. This helps them prepare before taking the real quiz.
- Past quiz results if already submitted.

### 5. GDB (Graded Discussion Board) detail

Opened when the student clicks a GDB item. Shows:

- GDB topic/question posted by the professor.
- Due date and marks.
- A text editor where the student writes their response.
- AI assistance panel: the student can ask the AI for help understanding the topic or drafting a response (the AI knows the course material from lecture notes).
- Submission status.

### 6. Lecture notes / AI study page

A page (or panel within course detail) where the student can read AI-generated notes for any lecture. Shows:

- Lecture title and number.
- The AI-generated summary/notes from that lecture's content (generated from video transcription + reading material).
- Key concepts highlighted.
- An AI chat panel where the student can ask questions about the lecture content and get answers grounded in the actual lecture material.
- Navigation to go to next/previous lecture.

### 7. AI Tutor / Chat

A dedicated chat interface where the student can ask questions across all their course content. Shows:

- A conversation interface (chat bubbles).
- The AI knows all lecture material from all courses and can answer questions, explain concepts, and help the student study.
- The student can reference specific courses, lectures, or topics in their questions.
- Previous conversations are saved.

### 8. Notifications / Settings

A settings page where the student configures:

- Email address for deadline alerts.
- How far in advance they want to be alerted (e.g. 72 hours, 24 hours, 2 hours before deadline).
- SMTP email configuration (server, username, password) for sending alerts.
- LMS credentials (username and password for the university LMS, stored locally).
- Sync interval (how often the background scraper runs, default every 30 minutes).
- Daily digest option: receive a single morning email listing everything due that day.

### 9. Daily planner (future)

A day-view planner that the student can use to schedule their study sessions. Shows:

- Everything due in the next 7 days on a timeline.
- Time blocks the student can drag to allocate study time for each course/task.
- Suggested schedule based on deadline urgency and estimated effort.

---

## Key user flows

**Flow 1 — Student opens the app in the morning:**
Dashboard shows today's deadlines at a glance. Synced automatically in the background. Student sees 2 assignments due today, 1 quiz tomorrow, 1 GDB in 3 days. Colors and urgency indicators tell them what needs attention first.

**Flow 2 — Student works on an assignment:**
Student clicks the assignment → sees professor's instructions file → reads the question → writes their solution → uploads file and submits from within the app. The app handles the LMS submission and confirms it.

**Flow 3 — Student prepares for a quiz:**
Student clicks a quiz → goes to practice mode → AI generates questions from the relevant lectures → student practices and gets instant answers → feels ready → clicks to open real quiz on LMS.

**Flow 4 — Student studies a lecture:**
Student opens a course → sees they're on lecture 8 → clicks lecture 9 → reads AI notes instead of watching a 45-minute video → asks the AI tutor a follow-up question → marks lecture as done → progress bar advances.

**Flow 5 — Student gets an email alert:**
App sends email at 7am: "You have 2 deadlines today — CS401 Assignment due at midnight, CS502 Quiz due at 11pm." Student opens the app and handles them.

---

## Data the app works with

- **Courses**: code (e.g. CS401), full title, semester
- **Assignments**: title, open date, due date, total marks, submission status, professor's file, student's submitted file
- **Quizzes**: title, start datetime, end datetime, total marks, submission status
- **GDBs** (Graded Discussion Boards): topic, due date, total marks, submission status
- **Lectures**: number, title, content types (video / reading / handout), duration, completed or not
- **AI Notes**: per-lecture text generated from transcription
- **Sync runs**: timestamp, status, items added/updated
- **Notifications**: type, scheduled time, sent status

---

## Technical context for the designer

- Single-page React application running locally on the student's machine
- Backend API at localhost — no internet authentication required for the UI
- Student logs into the university LMS once (the session is saved); after that everything is automatic
- The app works offline for reading notes and reviewing data — only sync requires internet
- This is a personal productivity tool, not a multi-user platform

---

---

# Section 2 — Claude Design Prompt (Phase 2 additions)

These are new screens and interactions that have been built on the backend but need UI/UX design. They extend the app designed in Section 1. Use the same dark design system, typography, and component style already established.

---

## Context: what changed

The app now automatically processes every lecture video. For each lecture it:
1. Fetches the YouTube transcript
2. Sends it to an AI which generates a complete structured handout
3. Saves the handout to the database and to the student's Obsidian vault

The handout is not a summary. It is a complete self-contained study document — the student should be able to learn the full lecture content by reading it, without watching the video. It includes concept explanations, definitions, formulas, worked examples, external references (links to free resources, Wikipedia, YouTube explainers), and 3–5 practice questions.

The student also tracks their progress through a lecture not as a single done/not-done toggle, but as a checklist of **sections within the handout**. Each section of the handout is a completable unit. The lecture is auto-marked complete when all sections are checked off, or the student can mark the whole lecture done in one tap.

The app also shows a **"what to study next"** panel — an AI-generated learning path that tells the student which lecture to open next across all their courses, based on upcoming deadlines, quiz dates, and how far behind they are.

---

## New and redesigned screens

### Screen A — Lecture handout reader

The main study view. Opened when the student clicks a lecture that has a generated handout.

**Layout:**
- Left sidebar: table of contents for the handout sections (sticky, collapsible on mobile). Each section has a checkbox next to it. Checked sections are visually struck through or dimmed.
- Main content area: the handout rendered as rich text — headings, paragraphs, definition tables, code/formula blocks, bullet lists.
- Right panel (collapsible): the original YouTube video embedded at the timestamp for the current section being read. As the student scrolls between sections, the video seeks to the corresponding timestamp automatically.

**Content structure of every handout:**
1. **Overview** — what this lecture covers and why it matters
2. **Key concepts** — one sub-section per concept, each with:
   - Clear explanation in plain language
   - A YouTube timestamp link back to the exact moment in the VU lecture video where this concept is explained
   - 1–3 external reference links (free: Wikipedia, Khan Academy, YouTube explainers, official docs, GeeksForGeeks, etc.)
3. **Definitions** — a clean two-column table: Term | Definition
4. **Formulas / Algorithms** — only present if the lecture covers math or step-by-step procedures; rendered in a monospace code block
5. **Worked examples** — concrete examples with step-by-step solutions
6. **Practice questions** — 3–5 questions the student should be able to answer after this lecture; collapsible answer reveal
7. **Further reading** — curated list of free resources (articles, videos, documentation) with short descriptions of what each one adds

**Interactions:**
- Checking a section checkbox marks it done and saves progress immediately
- "Mark all done" button at the top completes the entire lecture at once
- When all sections are checked, a subtle celebration animation plays and the lecture status updates to "completed" automatically
- Each YouTube timestamp link opens the embedded video at that exact second (or opens YouTube in a new tab if video panel is closed)
- External reference links open in a new tab
- Student can add a personal note to any section (small text area that expands inline, saved locally)

---

### Screen B — Transcript viewer

Accessible from the lecture handout page via a "View transcript" toggle/tab.

Shows the raw transcript text that was fetched from YouTube. Useful when the student wants to see the exact words or find a specific moment.

**Features:**
- Full transcript text in a scrollable panel
- Each paragraph or segment is clickable — clicking it seeks the embedded video to that timestamp
- A search bar to find specific words or phrases in the transcript
- Quality indicator badge: "Good quality" / "Auto-generated" / "Mixed language" showing the student what they're reading
- A "Re-generate handout" button that lets the student trigger a fresh AI generation if they think the handout is wrong or incomplete

---

### Screen C — "What to study next" panel

A persistent panel or widget visible on the Dashboard and on the Course detail page.

**Purpose:** The student opens the app and immediately knows exactly what to do next without having to think about it.

**Shows:**
- A ranked list of 3–5 recommended next actions, e.g.:
  - "Read CS401 Lecture 7 — Pipelining (quiz in 3 days, this lecture is tested)"
  - "Complete CS301 Lectures 4–6 handouts (you're 6 lectures behind)"
  - "Review CS502 Lecture 12 — you marked it done but there's a GDB on this topic due tomorrow"
- Each recommendation is a direct link to that lecture's handout reader
- Recommendations are generated by the AI based on: upcoming deadlines, quiz dates, how far behind the student is per course, and which lectures are flagged as likely to appear in upcoming assessments
- A "refresh recommendations" button

---

### Screen D — Lecture list (redesigned)

The lecture list inside Course detail needs to show more than a done/not-done toggle now.

**Each lecture row shows:**
- Lecture number and title
- Status chip: Not started / In progress / Completed
- A mini progress bar showing how many sections within the handout are checked (e.g. "4 of 7 sections done")
- Icons: video available, handout ready, transcript available
- Handout generation status if not ready yet: "Generating…" with a spinner, or "Pending" if queued
- Clicking the row opens the handout reader (Screen A)
- A secondary action: "Watch on YouTube" opens the video directly

**Lecture list states to design:**
- Lecture with no YouTube ID yet (scraper hasn't visited it): grayed out, "Video not linked yet"
- Lecture with YouTube ID but handout not generated yet: shows "Handout queued" or "Generating"
- Lecture with handout ready and 0 sections done: "Not started"
- Lecture with handout ready and some sections done: "In progress" + section progress bar
- Lecture fully completed: "Completed" with a checkmark, row slightly dimmed

---

## Data the new screens work with

- **Handout**: structured markdown document divided into named sections; stored in DB and Obsidian vault
- **Sections**: each named section of the handout is a separate completable unit; student progress tracked per section per lecture
- **Timestamps**: each key concept in the handout links to a YouTube timestamp (seconds into the video)
- **External references**: each concept has 1–3 curated links with title and short description
- **Transcript**: raw text with per-segment timestamps; stored in DB
- **Transcript quality**: "good" / "auto-generated" / "poor" — shown to student as an indicator
- **Recommendations**: AI-generated list of next study actions, refreshed on demand

---

## Tone and feel

Same dark design system as Section 1. The handout reader should feel like a premium reading experience — think a cross between a well-formatted textbook and a developer docs site. Generous whitespace, clear typographic hierarchy, the code/formula blocks look sharp. The YouTube video panel on the right feels like a companion, not a distraction — unobtrusive until needed.
