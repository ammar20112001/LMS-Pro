import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { fetchLectureNotes, triggerNotesGeneration, retryLecture, LectureNotes, Course } from "../api/client";

const COURSE_COLORS = [
  "#6366f1","#8b5cf6","#06b6d4","#10b981","#f59e0b","#ef4444","#ec4899","#14b8a6",
];

interface Section {
  id: string;
  title: string;
  content: string;
  level: number;
}

function parseSections(md: string): Section[] {
  const lines = md.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;
  let contentLines: string[] = [];

  for (const line of lines) {
    const h2 = line.match(/^## (.+)/);
    const h1 = line.match(/^# (.+)/);
    if (h2 || h1) {
      if (current) {
        current.content = contentLines.join("\n").trim();
        sections.push(current);
      }
      const title = h2 ? h2[1] : h1![1];
      const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      current = { id, title, content: "", level: h2 ? 2 : 1 };
      contentLines = [];
    } else if (current) {
      contentLines.push(line);
    } else if (sections.length === 0 && line.trim()) {
      current = { id: "overview", title: "Overview", content: "", level: 2 };
      contentLines = [line];
    }
  }
  if (current) {
    current.content = contentLines.join("\n").trim();
    sections.push(current);
  }
  return sections.filter((s) => s.content.length > 0 || sections.length === 1);
}

function formatTimestamp(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function QualityBadge({ quality }: { quality: string | null }) {
  const map: Record<string, { label: string; cls: string }> = {
    ok:    { label: "Good quality",    cls: "quality--good" },
    poor:  { label: "Poor quality",    cls: "quality--poor" },
    unavailable: { label: "Unavailable", cls: "quality--poor" },
  };
  const q = (quality && map[quality]) || { label: "Auto-generated", cls: "quality--auto" };
  return <span className={`quality-badge ${q.cls}`}>{q.label}</span>;
}

function TranscriptPanel({
  text,
  textEn,
  quality,
  onTriggerRegen,
  regenLoading,
}: {
  text: string | null;
  textEn: string | null;
  quality: string | null;
  onTriggerRegen: () => void;
  regenLoading: boolean;
}) {
  const [search, setSearch] = useState("");

  const [showOriginal, setShowOriginal] = useState(false);
  const displayText = (!showOriginal && textEn) ? textEn : text;

  if (!text && !textEn) {
    return (
      <div className="handout-content" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text3)" }}>
        <p>Transcript not yet available.</p>
        <button className="btn-regenerate" style={{ marginTop: "1rem" }} onClick={onTriggerRegen} disabled={regenLoading}>
          {regenLoading ? "Fetching…" : "↺ Fetch transcript"}
        </button>
      </div>
    );
  }

  // Split into ~30-word chunks (works for Urdu/Hindi which doesn't use Western punctuation)
  const words = (displayText ?? "").split(/\s+/).filter(Boolean);
  const CHUNK = 30;
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += CHUNK) chunks.push(words.slice(i, i + CHUNK).join(" "));

  const filtered = search.trim()
    ? chunks.filter((c) => c.toLowerCase().includes(search.toLowerCase()))
    : chunks;

  function highlight(chunk: string) {
    if (!search.trim()) return chunk;
    const parts = chunk.split(new RegExp(`(${search})`, "gi"));
    return parts.map((p, i) =>
      p.toLowerCase() === search.toLowerCase()
        ? <mark key={i} className="transcript-mark">{p}</mark>
        : p
    );
  }

  return (
    <div className="handout-content" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div className="transcript-viewer__toolbar">
        <div className="transcript-search-wrap">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.3"/><path d="M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
          <input className="transcript-search" placeholder="Search transcript…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && <button className="transcript-search-clear" onClick={() => setSearch("")}>✕</button>}
        </div>
        <QualityBadge quality={quality} />
        {textEn && (
          <button className="btn-regenerate" onClick={() => setShowOriginal((v) => !v)}>
            {showOriginal ? "Show English" : "Show Original"}
          </button>
        )}
        <button className={`btn-regenerate ${regenLoading ? "btn-regenerate--loading" : ""}`} onClick={onTriggerRegen} disabled={regenLoading}>
          {regenLoading ? "Fetching…" : "↺ Re-fetch"}
        </button>
      </div>
      {search && <div className="transcript-result-count">{filtered.length} chunk{filtered.length !== 1 ? "s" : ""} matching "{search}"</div>}
      <div className="transcript-list">
        {filtered.map((chunk, i) => (
          <div key={i} className="transcript-seg" style={{ cursor: "default" }}>
            <span className="transcript-seg__ts">{String(i + 1).padStart(3, " ")}</span>
            <span className="transcript-seg__text">{highlight(chunk)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface SectionNoteProps {
  noteKey: string;
}
function SectionNote({ noteKey }: SectionNoteProps) {
  const [note, setNote] = useState(() => localStorage.getItem(noteKey) || "");
  const [editing, setEditing] = useState(false);
  const save = (v: string) => {
    setNote(v);
    v.trim() ? localStorage.setItem(noteKey, v) : localStorage.removeItem(noteKey);
  };
  if (!editing && !note) {
    return <button className="note-add-btn" onClick={() => setEditing(true)}>+ Add note</button>;
  }
  return (
    <div className="section-note">
      {editing ? (
        <>
          <textarea className="section-note__textarea" value={note} onChange={(e) => save(e.target.value)} placeholder="Your note…" rows={3} autoFocus />
          <button className="section-note__done" onClick={() => setEditing(false)}>Done</button>
        </>
      ) : (
        <div className="section-note__view" onClick={() => setEditing(true)}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 9.5L3 8 9 2l1 1-6 6-1.5.5z" stroke="currentColor" strokeWidth="1.2"/></svg>
          {note}
        </div>
      )}
    </div>
  );
}

interface Props {
  lectureId: number;
  courseId: number;
  serialNo: number;
  lectureTitle: string;
  course: Course | null;
  courseIndex: number;
  onBack: () => void;
}

export function HandoutReader({ lectureId, courseId, serialNo, lectureTitle, course, courseIndex, onBack }: Props) {
  const qc = useQueryClient();
  const color = COURSE_COLORS[courseIndex % COURSE_COLORS.length];

  const { data: notes, isLoading } = useQuery({
    queryKey: ["lecture-notes", courseId, lectureId],
    queryFn: () => fetchLectureNotes(courseId, lectureId),
    refetchInterval: (data) => {
      const status = data?.state?.data?.notes_status;
      return status === "transcribing" || status === "generating" ? 3000 : false;
    },
  });

  const regenMut = useMutation({
    mutationFn: () => {
      if (notes?.notes_status === "failed") return retryLecture(lectureId);
      return triggerNotesGeneration(lectureId);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lecture-notes", courseId, lectureId] }),
  });

  const progressKey = `lms-progress-${lectureId}`;
  const [doneSections, setDoneSections] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(progressKey) || "[]"); } catch { return []; }
  });

  const [activeTab, setActiveTab] = useState<"handout" | "transcript">("handout");
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const [celebrated, setCelebrated] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(progressKey, JSON.stringify(doneSections));
  }, [doneSections, progressKey]);

  const sections = notes ? parseSections(notes.notes_md || "") : [];
  const total = sections.length;
  const doneCount = doneSections.filter((id) => sections.some((s) => s.id === id)).length;
  const allDone = total > 0 && doneCount === total;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  useEffect(() => {
    if (allDone && !celebrated && doneCount > 0) setCelebrated(true);
  }, [allDone, celebrated, doneCount]);

  const toggleSection = (id: string) =>
    setDoneSections((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const markAllDone = () => setDoneSections(sections.map((s) => s.id));

  const scrollToSection = useCallback((id: string) => {
    const el = document.getElementById(`section-${id}`);
    if (el && contentRef.current) {
      contentRef.current.scrollTop = el.offsetTop - 24;
    }
    setActiveSection(id);
  }, []);

  useEffect(() => {
    if (activeTab !== "handout" || !contentRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setActiveSection((e.target as HTMLElement).dataset.sectionId || null); }),
      { threshold: 0.25, root: contentRef.current }
    );
    document.querySelectorAll(".handout-section").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [activeTab, sections.length]);

  const youtubeId = notes?.youtube_id && notes.youtube_id !== "NONE" ? notes.youtube_id : null;

  if (isLoading) {
    return (
      <div className="handout-page">
        <button className="btn-back" onClick={onBack}>← Back</button>
        <div className="empty-state" style={{ marginTop: "2rem" }}>Loading…</div>
      </div>
    );
  }

  const status = notes?.notes_status;
  const hasNotes = status === "done" && notes?.notes_md;
  const hasTranscript = !!notes?.transcript_raw;

  return (
    <div className="handout-page">
      {/* Top bar */}
      <div className="handout-topbar">
        <button className="btn-back" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Back
        </button>

        <div className="handout-topbar__center">
          <span className="course-detail__code" style={{ background: color + "22", color, border: `1px solid ${color}44` }}>
            {course?.code ?? `Course ${courseId}`} · Lec {serialNo}
          </span>
          <span className="handout-topbar__title">{lectureTitle}</span>
        </div>

        <div className="handout-topbar__right">
          {hasNotes && (
            <div className="handout-progress-strip" style={{ marginBottom: 0 }}>
              <div className="handout-progress-strip__bar">
                <div className="handout-progress-strip__fill" style={{ width: `${pct}%`, background: color }} />
              </div>
              <span className="handout-progress-strip__label">{doneCount}/{total}</span>
              {allDone && <span className="handout-complete-badge">✓ Done</span>}
            </div>
          )}
          {hasNotes && !allDone && <button className="btn-mark-all" onClick={markAllDone}>✓ Mark all done</button>}
          {youtubeId && (
            <button className={`btn-video-toggle ${videoOpen ? "btn-video-toggle--active" : ""}`} onClick={() => setVideoOpen((v) => !v)}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1.5 2.5h7a.75.75 0 01.75.75v5.5a.75.75 0 01-.75.75h-7a.75.75 0 01-.75-.75V3.25a.75.75 0 01.75-.75z" stroke="currentColor" strokeWidth="1.2"/><path d="M9.25 4.75l2-1.25v5l-2-1.25" stroke="currentColor" strokeWidth="1.2"/></svg>
              Video
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: 0, borderBottom: "1px solid var(--border)" }}>
        <button className={`tab ${activeTab === "handout" ? "tab--active" : ""}`} onClick={() => setActiveTab("handout")}>
          Handout {status === "done" ? "" : status === "transcribed" || status === "transcribing" ? "(generating…)" : "(pending)"}
        </button>
        <button className={`tab ${activeTab === "transcript" ? "tab--active" : ""}`} onClick={() => setActiveTab("transcript")}>
          Transcript {notes?.transcript_quality && <QualityBadge quality={notes.transcript_quality} />}
        </button>
      </div>

      {/* Three-region layout */}
      <div className={`handout-layout
        ${videoOpen && youtubeId ? "handout-layout--video" : ""}
        ${!hasNotes || activeTab !== "handout" ? "handout-layout--notoc" : ""}`}>

        {/* Left: ToC — only on handout tab when notes exist */}
        {hasNotes && activeTab === "handout" && (
          <nav className="handout-toc">
            <div className="handout-toc__heading">Sections</div>
            <div className="handout-toc__nav">
              {sections.map((sec) => {
                const done = doneSections.includes(sec.id);
                return (
                  <button
                    key={sec.id}
                    className={`toc-item ${activeSection === sec.id ? "toc-item--active" : ""} ${done ? "toc-item--done" : ""}`}
                    onClick={() => scrollToSection(sec.id)}
                  >
                    <span className="toc-item__icon">{done ? "✓" : "○"}</span>
                    <span className="toc-item__label">{sec.title}</span>
                    {done && <span className="toc-item__check">✓</span>}
                  </button>
                );
              })}
            </div>
          </nav>
        )}

        {/* Center: content */}
        {activeTab === "handout" ? (
          <div className="handout-content" ref={contentRef}>
            {/* Status banners */}
            {!hasNotes && !hasTranscript && (
              <div className="empty-state">
                {status === "transcribed" ? (
                  <>Transcript available. Click <strong>Transcript</strong> tab above to read it. Notes generation is currently disabled — AI provider needs to be configured.</>
                ) : status === "transcribing" ? (
                  "Fetching transcript… check back in a moment."
                ) : status === "failed" ? (
                  <>Transcript unavailable for this lecture. <button className="btn-regenerate" onClick={() => regenMut.mutate()} disabled={regenMut.isPending}>Retry</button></>
                ) : (
                  <>Handout not generated yet. <button className="btn-regenerate" onClick={() => regenMut.mutate()} disabled={regenMut.isPending}>Generate now</button></>
                )}
              </div>
            )}
            {!hasNotes && hasTranscript && (
              <div style={{ padding: "1.5rem 0", display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div className="completion-banner" style={{ background: "oklch(0.62 0.2 265 / 0.07)", borderColor: "oklch(0.62 0.2 265 / 0.2)" }}>
                  <span style={{ fontSize: "24px" }}>📝</span>
                  <div>
                    <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--accent)" }}>Transcript available</div>
                    <div style={{ fontSize: "12.5px", color: "var(--text3)", marginTop: "0.15rem" }}>Click the Transcript tab to read it. AI handout generation requires an AI provider to be configured.</div>
                  </div>
                </div>
                <button className="btn-regenerate" onClick={() => regenMut.mutate()} disabled={regenMut.isPending} style={{ alignSelf: "flex-start" }}>
                  {regenMut.isPending ? "Generating…" : "✨ Generate handout now"}
                </button>
              </div>
            )}
            {hasNotes && (
              <div className="handout-reading-inner">
                {allDone && celebrated && (
                  <div className="completion-banner">
                    <span className="completion-banner__icon">🎉</span>
                    <div>
                      <div className="completion-banner__title">Lecture completed!</div>
                      <div className="completion-banner__sub">All {total} sections done. Well done.</div>
                    </div>
                  </div>
                )}
                {sections.map((sec) => {
                  const done = doneSections.includes(sec.id);
                  return (
                    <div
                      key={sec.id}
                      id={`section-${sec.id}`}
                      className={`handout-section ${done ? "handout-section--done" : ""}`}
                      data-section-id={sec.id}
                    >
                      <div className="handout-section__header">
                        <label className="section-checkbox">
                          <input type="checkbox" checked={done} onChange={() => toggleSection(sec.id)} />
                          <span className="section-checkbox__box" />
                        </label>
                        <h2 className="handout-section__title">{sec.title}</h2>
                      </div>
                      <div className="handout-body">
                        <ReactMarkdown>{sec.content}</ReactMarkdown>
                      </div>
                      <SectionNote noteKey={`lms-note-${courseId}-${serialNo}-${sec.id}`} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <TranscriptPanel
            text={notes?.transcript_raw ?? null}
            textEn={notes?.transcript_en ?? null}
            quality={notes?.transcript_quality ?? null}
            onTriggerRegen={() => regenMut.mutate()}
            regenLoading={regenMut.isPending}
          />
        )}

        {/* Right: video panel */}
        {videoOpen && youtubeId && (
          <div className="handout-video-panel">
            <div className="handout-video-panel__header">
              <span className="handout-video-panel__label">Lecture Video</span>
              <button className="file-viewer__close" onClick={() => setVideoOpen(false)}>✕</button>
            </div>
            <div className="handout-video-panel__embed">
              <iframe
                src={`https://www.youtube.com/embed/${youtubeId}?modestbranding=1&rel=0`}
                title="Lecture"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                style={{ width: "100%", aspectRatio: "16/9", display: "block", borderRadius: "var(--radius-sm)" }}
              />
            </div>
            <div className="handout-video-panel__hint">
              Click a timestamp button in the handout to seek to that point.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
