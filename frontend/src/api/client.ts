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
