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

export const fetchCourseItems = (courseId: number): Promise<Item[]> =>
  api.get(`/api/courses/${courseId}/items`).then((r) => r.data);

export const fetchDueSoon = (days = 14): Promise<Item[]> =>
  api.get("/api/items", { params: { due_within_days: days } }).then((r) => r.data);

export const fetchSyncRuns = (): Promise<SyncRun[]> =>
  api.get("/api/sync/runs").then((r) => r.data);

export const triggerSync = (): Promise<void> =>
  api.post("/api/sync").then(() => {});

export const markComplete = (id: number): Promise<Item> =>
  api.post(`/api/items/${id}/complete`).then((r) => r.data);

export const markUncomplete = (id: number): Promise<Item> =>
  api.post(`/api/items/${id}/uncomplete`).then((r) => r.data);
