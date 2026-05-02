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
