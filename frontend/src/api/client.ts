import axios from "axios";

export const api = axios.create({ baseURL: "http://localhost:8000" });

export interface Course {
  id: number;
  code: string;
  title: string;
  term: string;
  last_synced_at: string | null;
}

export interface Item {
  id: number;
  course_id: number;
  course_code: string;
  course_title: string;
  kind: "assignment" | "quiz" | "gdb";
  title: string;
  lesson: string | null;
  total_marks: string | null;
  status: string | null;
  opens_at: string | null;
  due_at: string | null;
  file_url: string | null;
  completed_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

export interface SyncRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  items_added: number;
  items_updated: number;
  courses_synced: number;
}

export const fetchCourses = (): Promise<Course[]> =>
  api.get("/api/courses").then((r) => r.data);

export const fetchItems = (): Promise<Item[]> =>
  api.get("/api/items").then((r) => r.data);

export const fetchCourseItems = (courseId: number): Promise<Item[]> =>
  api.get(`/api/courses/${courseId}/items`).then((r) => r.data);

export const fetchDueSoon = (days = 14): Promise<Item[]> =>
  api.get("/api/items", { params: { due_within_days: days } }).then((r) => r.data);

export interface Lecture {
  id: number;
  course_id: number;
  week: number;
  serial_no: number;
  title: string;
  has_video: boolean;
  has_reading: boolean;
  youtube_id: string | null;
  notes_status: string;
  transcript_quality: string | null;
  notes_generated_at: string | null;
}

export interface CourseProgress {
  course_id: number;
  current_lecture_serial: number;
  total_lectures: number;
}

export const fetchSyncRuns = (): Promise<SyncRun[]> =>
  api.get("/api/sync/runs").then((r) => r.data);

export const triggerSync = (): Promise<void> =>
  api.post("/api/sync").then(() => {});

export const fetchLectures = (courseId: number): Promise<Lecture[]> =>
  api.get(`/api/courses/${courseId}/lectures`).then((r) => r.data);

export const fetchProgress = (courseId: number): Promise<CourseProgress> =>
  api.get(`/api/courses/${courseId}/progress`).then((r) => r.data);

export const setProgress = (courseId: number, serial: number): Promise<CourseProgress> =>
  api.post(`/api/courses/${courseId}/progress?serial=${serial}`).then((r) => r.data);

export const downloadFile = (itemId: number): string =>
  `http://localhost:8000/api/items/${itemId}/file`;

export interface LectureNotes {
  id: number;
  title: string;
  notes_md: string | null;
  notes_status: string;
  transcript_raw: string | null;
  transcript_en: string | null;
  transcript_quality: string | null;
  transcript_source: string | null;
  transcript_retries: number;
  notes_generated_at: string | null;
  youtube_id: string | null;
}

export interface PipelineLecture {
  id: number | null;          // LectureVideo.id (null if unscraped)
  lecture_id: number;
  course_id: number;
  course_code: string;
  lecture_serial: number;     // was serial_no
  lecture_title: string;      // was title
  seq: number;                // 1, 2, 3 — which video in the lesson
  notes_status: string;
  transcript_retries: number;
  yt_status: "found" | "none" | "unchecked";
  has_transcript: boolean;
  has_translation: boolean;
  has_notes: boolean;
}

export interface PipelineStatus {
  stages: {
    video: number;
    youtube_id: number;
    transcript: number;
    translation: number;
    handout: number;
  };
  lectures: PipelineLecture[];
}

export const fetchLectureNotes = (courseId: number, lectureId: number): Promise<LectureNotes> =>
  api.get(`/api/courses/${courseId}/lectures/${lectureId}/notes`).then((r) => r.data);

export const triggerNotesGeneration = (lectureId: number): Promise<Record<string, unknown>> =>
  api.post(`/api/notes/run?lecture_id=${lectureId}`).then((r) => r.data);

export const retryLecture = (lectureId: number): Promise<Record<string, unknown>> =>
  api.post(`/api/notes/retry/${lectureId}`).then((r) => r.data);

export const setYoutubeId = (courseId: number, lectureId: number, youtubeId: string): Promise<Record<string, unknown>> =>
  api.put(`/api/courses/${courseId}/lectures/${lectureId}/youtube_id`, { youtube_id: youtubeId }).then((r) => r.data);

export const setVideoYoutubeId = (videoId: number, youtubeId: string): Promise<Record<string, unknown>> =>
  api.put(`/api/notes/video/${videoId}/youtube_id`, { youtube_id: youtubeId }).then((r) => r.data);

export const fetchPipelineStatus = (): Promise<PipelineStatus> =>
  api.get("/api/notes/pipeline").then((r) => r.data);

// ── Study Guide ───────────────────────────────────────────────────────────────

export interface StudyLecture {
  id: number;
  serial_no: number;
  title: string;
  has_video: boolean;
  notes_status: string;
}

export interface StudyItem {
  id: number;
  kind: "assignment" | "quiz" | "gdb";
  title: string;
  lesson: string | null;
  due_at: string | null;
  opens_at: string | null;
  status: string | null;
}

export interface StudyCourse {
  id: number;
  code: string;
  title: string;
  term: string;
  current_serial: number;
  total_lectures: number;
  next_lectures: StudyLecture[];
  open_items: StudyItem[];
}

export interface StudyGuideData {
  courses: StudyCourse[];
}

export const fetchStudyGuide = (): Promise<StudyGuideData> =>
  api.get("/api/study/guide").then((r) => r.data);

// ── Phase 3: Assignment Workspace ─────────────────────────────────────────────

export const getHint = (itemId: number, question: string, solutionSoFar: string) =>
  api.post(`/api/assignments/${itemId}/hint`, { question, solution_so_far: solutionSoFar }).then((r) => r.data as { hint: string });

export const completeWithAI = (itemId: number, question: string) =>
  api.post(`/api/assignments/${itemId}/complete`, { question }).then((r) => r.data as { solution: string });

export const formatForUpload = (itemId: number, question: string, solution: string) =>
  api.post(`/api/assignments/${itemId}/format`, { question, solution }).then((r) => r.data as { filename: string; file_url: string });

export const submitAssignment = (itemId: number, filename: string) =>
  api.post(`/api/assignments/${itemId}/submit`, { filename }).then((r) => r.data as { status: string; message: string });

// ── Phase 3B: Study Canvas ─────────────────────────────────────────────────────

export interface CanvasCourse {
  course_code: string;
  total_chunks: number;
  enriched_chunks: number;
}

export interface CanvasChunkSummary {
  id: number;
  lecture_no: number;
  title: string;
  enrich_status: string;
  enriched_at: string | null;
  is_completed: boolean;
  image_count: number;
}

export interface CanvasImage {
  seq: number;
  page_no: number;
  url: string;
}

export interface CanvasSection {
  id: number;
  section_key: string;
  level: number;   // 0 = intro/overview, 1 = ##, 2 = ###
  title: string;
  body: string;
  order: number;
  is_completed: boolean;
}

export interface CanvasChunk {
  id: number;
  course_code: string;
  lecture_no: number;
  title: string;
  enrich_status: string;
  enriched_md: string | null;
  enriched_at: string | null;
  is_completed: boolean;
  page_start: number;
  page_end: number;
  images: CanvasImage[];
  images_by_page: Record<string, CanvasImage[]>;  // page_no (string key) → images
  sections: CanvasSection[];
}

export const fetchCanvasCourses = (): Promise<CanvasCourse[]> =>
  api.get("/api/study-canvas/courses").then((r) => r.data);

export const fetchCanvasChunks = (courseCode: string): Promise<CanvasChunkSummary[]> =>
  api.get(`/api/study-canvas/${courseCode}/chunks`).then((r) => r.data);

export const fetchCanvasChunk = (chunkId: number): Promise<CanvasChunk> =>
  api.get(`/api/study-canvas/chunks/${chunkId}`).then((r) => r.data);

export const enrichWithSonnet = (chunkId: number, instructions: string): Promise<{ status: string }> =>
  api.post(`/api/study-canvas/chunks/${chunkId}/enrich`, { instructions }).then((r) => r.data);

export const setChunkCompletion = (chunkId: number, is_completed: boolean): Promise<{ ok: boolean }> =>
  api.post(`/api/study-canvas/chunks/${chunkId}/complete`, { is_completed }).then((r) => r.data);

export const setSectionCompletion = (sectionId: number, is_completed: boolean): Promise<{ ok: boolean }> =>
  api.post(`/api/study-canvas/sections/${sectionId}/complete`, { is_completed }).then((r) => r.data);

export const triggerHandoutIngest = (): Promise<{ status: string }> =>
  api.post("/api/study-canvas/ingest").then((r) => r.data);

// ── Focus Mode ────────────────────────────────────────────────────────────────

export interface SectionNote {
  id: number;
  section_id: number;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface ExternalResource {
  id: number;
  section_id: number;
  selected_text: string;
  instructions: string | null;
  resources: { url: string; title: string; snippet: string }[];
  created_at: string;
}

export interface SectionScreenshot {
  id: number;
  section_id: number;
  url: string;
  caption: string | null;
  seq: number;
  created_at: string;
}

export interface FocusSection extends CanvasSection {
  notes: SectionNote[];
  resources: ExternalResource[];
  screenshots: SectionScreenshot[];
}

export interface FocusChunk {
  id: number;
  course_code: string;
  lecture_no: number;
  title: string;
  enrich_status: string;
  is_completed: boolean;
  page_start: number;
  page_end: number;
  images: CanvasImage[];
  sections: FocusSection[];
}

export interface FocusSession {
  id: number;
  course_code: string;
  chunk_ids: number[];
  label: string | null;
  budget_minutes: number;
  elapsed_seconds: number;
  last_chunk_id: number | null;
  created_at: string;
  updated_at: string;
}

export const fetchFocusChunks = (chunkIds: number[]): Promise<FocusChunk[]> =>
  api.post("/api/focus/chunks/bulk", { chunk_ids: chunkIds }).then((r) => r.data);

export const addNote = (sectionId: number, body: string): Promise<SectionNote> =>
  api.post(`/api/focus/sections/${sectionId}/notes`, { body }).then((r) => r.data);

export const updateNote = (noteId: number, body: string): Promise<SectionNote> =>
  api.put(`/api/focus/notes/${noteId}`, { body }).then((r) => r.data);

export const deleteNote = (noteId: number): Promise<{ ok: boolean }> =>
  api.delete(`/api/focus/notes/${noteId}`).then((r) => r.data);

export const listFocusSessions = (courseCode?: string): Promise<FocusSession[]> =>
  api.get("/api/focus/sessions", { params: courseCode ? { course_code: courseCode } : {} }).then((r) => r.data);

export const createFocusSession = (data: {
  course_code: string; chunk_ids: number[]; label?: string; budget_minutes?: number;
}): Promise<FocusSession> =>
  api.post("/api/focus/sessions", data).then((r) => r.data);

export const updateFocusSession = (sessionId: number, data: {
  elapsed_seconds?: number; last_chunk_id?: number; budget_minutes?: number; label?: string;
}): Promise<FocusSession> =>
  api.patch(`/api/focus/sessions/${sessionId}`, data).then((r) => r.data);

export const deleteFocusSession = (sessionId: number): Promise<{ ok: boolean }> =>
  api.delete(`/api/focus/sessions/${sessionId}`).then((r) => r.data);

export const generateResources = (sectionId: number, selectedText: string, instructions?: string): Promise<ExternalResource> =>
  api.post(`/api/focus/sections/${sectionId}/resources`, { selected_text: selectedText, instructions: instructions ?? "" }).then((r) => r.data);

export const deleteResource = (resourceId: number): Promise<{ ok: boolean }> =>
  api.delete(`/api/focus/resources/${resourceId}`).then((r) => r.data);

export const uploadScreenshot = (sectionId: number, file: File, caption?: string): Promise<SectionScreenshot> => {
  const formData = new FormData();
  formData.append("file", file);
  if (caption) formData.append("caption", caption);
  return api.post(`/api/focus/sections/${sectionId}/screenshots`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  }).then((r) => r.data);
};

export const deleteScreenshot = (screenshotId: number): Promise<{ ok: boolean }> =>
  api.delete(`/api/focus/screenshots/${screenshotId}`).then((r) => r.data);

export const updateScreenshotCaption = (screenshotId: number, caption: string): Promise<SectionScreenshot> =>
  api.patch(`/api/focus/screenshots/${screenshotId}/caption`, { body: caption }).then((r) => r.data);

export interface ChatMessage {
  id: number;
  session_id: number;
  section_id: number | null;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export const getChatMessages = (sessionId: number): Promise<ChatMessage[]> =>
  api.get(`/api/focus/sessions/${sessionId}/messages`).then((r) => r.data);

export const sendChatMessage = (sessionId: number, content: string, sectionId?: number): Promise<ChatMessage> =>
  api.post(`/api/focus/sessions/${sessionId}/chat`, { content, section_id: sectionId ?? null }).then((r) => r.data);

export const deleteChatMessage = (messageId: number): Promise<{ ok: boolean }> =>
  api.delete(`/api/focus/messages/${messageId}`).then((r) => r.data);

export interface SearchResult {
  id: number;
  title: string;
  level: number;
  section_key: string;
  body_snippet: string;
  chunk_id: number;
  chunk_title: string;
  lecture_no: number;
  course_code: string;
}

export const searchSections = (q: string, courseCode?: string): Promise<SearchResult[]> =>
  api.get("/api/study-canvas/search", {
    params: { q, ...(courseCode ? { course_code: courseCode } : {}) },
  }).then((r) => r.data);

// ── Study Plan ─────────────────────────────────────────────────────────────────

export interface PlanDeadline {
  item_id: number;
  title: string;
  due_at: string;
  is_past: boolean;
  is_completed: boolean;
  days_left: number | null;
  quiz_number: number | null;
  total_quizzes: number | null;
  lecture_range: [number, number] | null;
  lectures_needed: number;
  lectures_covered: number;
  estimated_minutes: number;
}

export interface TheoryCourse {
  course_code: string;
  course_title: string;
  current_lecture: number;
  total_lectures: number;
  backlog_lectures: number;
  deadlines: PlanDeadline[];
}

export interface PracticalTask {
  item_id: number;
  title: string;
  kind: string;
  due_at: string;
  is_past: boolean;
  is_completed: boolean;
  days_left: number | null;
  status: string | null;
}

export interface PracticalCourse {
  course_code: string;
  course_title: string;
  type: "cpp_runner" | "ai_marked";
  upcoming: PracticalTask[];
  past: PracticalTask[];
}

export interface StudyPlan {
  theory: TheoryCourse[];
  practicals: PracticalCourse[];
}

export interface PlanLecture {
  serial_no: number;
  title: string;
  urgency: "done" | "behind" | "soon" | "later";
  estimated_minutes: number;
  chunk_id: number | null;
  deadline_title?: string;
}

export interface PlaygroundGroup {
  behind: PlanLecture[];
  soon: PlanLecture[];
  later: PlanLecture[];
}

export interface TheoryCourseFull extends TheoryCourse {
  deadlines: (PlanDeadline & { lectures: PlanLecture[] })[];
  playground: PlaygroundGroup;
}

export const fetchStudyPlan = (): Promise<StudyPlan> =>
  api.get("/api/study-plan/").then((r) => r.data);

export const fetchCoursePlan = (courseCode: string): Promise<TheoryCourseFull> =>
  api.get(`/api/study-plan/${courseCode}`).then((r) => r.data);

export interface AiMarkResult {
  marks: number | null;
  max_marks: number;
  grade: string;
  summary: string;
  strengths: string[];
  issues: string[];
  feedback: string;
}

export const aiMarkSubmission = (
  itemId: number,
  taskDescription: string,
  solution: string,
  maxMarks?: number
): Promise<AiMarkResult> =>
  api.post(`/api/assignments/${itemId}/ai-mark`, {
    task_description: taskDescription,
    solution,
    max_marks: maxMarks ?? 10,
  }).then((r) => r.data);
