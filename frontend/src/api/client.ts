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
