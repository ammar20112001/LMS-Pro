import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FocusMode } from "./FocusMode";
import {
  fetchCanvasCourses,
  fetchCanvasChunks,
  fetchCanvasChunk,
  enrichWithSonnet,
  setChunkCompletion,
  setSectionCompletion,
  listFocusSessions,
  searchSections,
  triggerHandoutIngest,
  CanvasCourse,
  CanvasChunkSummary,
  CanvasChunk,
  CanvasImage,
  CanvasSection,
  FocusSession,
  SearchResult,
} from "../api/client";

// ── Utilities ──────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  done: "var(--green)",
  enriching: "var(--amber)",
  pending: "var(--text3)",
  failed: "var(--red)",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {status === "enriching" && (
        <span style={{
          width: 6, height: 6, borderRadius: "50%",
          background: "var(--amber)", display: "inline-block",
          animation: "pulse 1.2s ease-in-out infinite",
        }} />
      )}
      <span style={{
        fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
        color: STATUS_COLOR[status] ?? "var(--text3)", textTransform: "uppercase",
      }}>
        {status}
      </span>
    </span>
  );
}

function MarkdownBody({ md }: { md: string }) {
  const html = md
    .replace(/^```[\w]*\n([\s\S]*?)^```/gm, "<pre><code>$1</code></pre>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/^---$/gm, "<hr />")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/\n\n/g, "</p><p>");
  return (
    <div className="canvas-md" dangerouslySetInnerHTML={{ __html: `<p>${html}</p>` }} />
  );
}

// ── Completion tick ─────────────────────────────────────────────────────────────

function Tick({ done, onToggle, size = 16 }: { done: boolean; onToggle: () => void; size?: number }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      title={done ? "Mark incomplete" : "Mark complete"}
      style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        border: `2px solid ${done ? "var(--green)" : "var(--border2)"}`,
        background: done ? "var(--green)" : "transparent",
        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.15s",
      }}
    >
      {done && (
        <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 10 10" fill="none">
          <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

// ── Inline image strip ─────────────────────────────────────────────────────────

function ImageStrip({ images }: { images: CanvasImage[] }) {
  if (!images.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "12px 0 4px" }}>
      {images.map((img) => (
        <img
          key={img.seq}
          src={`http://localhost:8000${img.url}`}
          alt={`Figure ${img.seq}`}
          style={{
            maxWidth: 300, maxHeight: 220, objectFit: "contain",
            border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
            background: "var(--bg2)", cursor: "zoom-in",
          }}
          onClick={() => window.open(`http://localhost:8000${img.url}`, "_blank")}
        />
      ))}
    </div>
  );
}

// ── Distribute images across sections ──────────────────────────────────────────

function getImagesForSection(
  idx: number,
  total: number,
  images: CanvasImage[],
  pageStart: number,
  pageEnd: number,
): CanvasImage[] {
  if (!images.length || total === 0) return [];
  const totalPages = pageEnd - pageStart + 1;

  // Separate page-located vs legacy (page_no outside chunk range)
  const located = images.filter((img) => img.page_no >= pageStart && img.page_no <= pageEnd);
  const legacy = images.filter((img) => img.page_no < pageStart || img.page_no > pageEnd);

  // Located images: filter by page range of this section
  const secPageStart = pageStart + Math.floor((idx / total) * totalPages);
  const secPageEnd = pageStart + Math.floor(((idx + 1) / total) * totalPages) - 1;
  const fromPages = located.filter((img) => img.page_no >= secPageStart && img.page_no <= secPageEnd);

  // Legacy images: distribute by seq proportionally across sections
  const fromLegacy = legacy.filter((_, i) => {
    const assignedSection = Math.floor((i / legacy.length) * total);
    return assignedSection === idx;
  });

  return [...fromPages, ...fromLegacy];
}

// ── Section block (flat — no expand/collapse) ──────────────────────────────────

function SectionBlock({
  section,
  images,
  onToggleComplete,
}: {
  section: CanvasSection;
  images: CanvasImage[];
  onToggleComplete: (id: number, current: boolean) => void;
}) {
  const isMain = section.level <= 1;   // ## → main section, gets tick
  const isSub = section.level === 2;   // ### → subsection, no tick

  return (
    <div
      id={`section-${section.id}`}
      style={{
        marginBottom: isMain ? 20 : 10,
        paddingLeft: isSub ? 14 : 0,
        borderLeft: isSub ? "2px solid var(--border)" : "none",
        opacity: section.is_completed ? 0.55 : 1,
        transition: "opacity 0.2s",
      }}
    >
      {/* Section heading */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        {isMain && (
          <Tick
            done={section.is_completed}
            onToggle={() => onToggleComplete(section.id, section.is_completed)}
            size={15}
          />
        )}
        <span style={{
          fontSize: isMain ? 15 : 13,
          fontWeight: isMain ? 700 : 600,
          color: isMain ? "var(--text)" : "var(--accent)",
          letterSpacing: isMain ? "-0.01em" : "normal",
          textDecoration: section.is_completed ? "line-through" : "none",
        }}>
          {section.title}
        </span>
      </div>

      {/* Body text */}
      <MarkdownBody md={section.body} />

      {/* Inline images after the text */}
      <ImageStrip images={images} />
    </div>
  );
}

// ── Reading pane ───────────────────────────────────────────────────────────────

function ReadingPane({
  chunk,
  onChunkComplete,
  onSectionComplete,
  showEnrichPanel,
  setShowEnrichPanel,
}: {
  chunk: CanvasChunk;
  onChunkComplete: (done: boolean) => void;
  onSectionComplete: (id: number, done: boolean) => void;
  showEnrichPanel: boolean;
  setShowEnrichPanel: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [enrichInstructions, setEnrichInstructions] = useState("");

  const enrichMutation = useMutation({
    mutationFn: ({ id, instructions }: { id: number; instructions: string }) =>
      enrichWithSonnet(id, instructions),
    onSuccess: () => {
      setShowEnrichPanel(false);
      setEnrichInstructions("");
      qc.invalidateQueries({ queryKey: ["canvas-chunk", chunk.id] });
    },
  });

  const completedCount = chunk.sections.filter((s) => s.level <= 1 && s.is_completed).length;
  const mainSections = chunk.sections.filter((s) => s.level <= 1).length;
  const pct = mainSections > 0 ? Math.round((completedCount / mainSections) * 100) : 0;

  return (
    <>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
          <Tick done={chunk.is_completed} onToggle={() => onChunkComplete(!chunk.is_completed)} size={20} />
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px", color: "var(--text)" }}>
              {chunk.title}
            </h2>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <StatusBadge status={chunk.enrich_status} />
              <span style={{ fontSize: 11, color: "var(--text3)" }}>
                Pages {chunk.page_start + 1}–{chunk.page_end + 1}
              </span>
              {mainSections > 0 && (
                <span style={{ fontSize: 11, color: pct === 100 ? "var(--green)" : "var(--text3)" }}>
                  {completedCount}/{mainSections} sections done
                </span>
              )}
            </div>
          </div>
          <button
            className="btn btn--ghost"
            style={{ fontSize: 12, padding: "0.4rem 0.9rem", flexShrink: 0 }}
            onClick={() => setShowEnrichPanel(!showEnrichPanel)}
          >
            Enrich with Sonnet
          </button>
        </div>

        {/* Section progress bar */}
        {mainSections > 0 && (
          <div style={{ height: 3, background: "var(--bg3)", borderRadius: 99, overflow: "hidden", marginLeft: 30 }}>
            <div style={{
              height: "100%", width: `${pct}%`,
              background: "var(--green)", borderRadius: 99, transition: "width 0.3s",
            }} />
          </div>
        )}
      </div>

      {/* Sonnet panel */}
      {showEnrichPanel && (
        <div style={{
          background: "var(--bg2)", border: "1px solid var(--border2)",
          borderRadius: "var(--radius)", padding: "1rem", marginBottom: "1.2rem",
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Enrich with Claude Sonnet</div>
          <textarea
            value={enrichInstructions}
            onChange={(e) => setEnrichInstructions(e.target.value)}
            placeholder="e.g. Add Python examples. Link to GeeksForGeeks. Simplify the math."
            style={{
              width: "100%", minHeight: 72, background: "var(--bg3)",
              border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
              color: "var(--text)", padding: "0.6rem 0.8rem",
              fontSize: 13, fontFamily: "var(--font)", resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
            <button className="btn btn--ghost" style={{ fontSize: 12 }} onClick={() => setShowEnrichPanel(false)}>
              Cancel
            </button>
            <button
              className="btn"
              style={{ fontSize: 12 }}
              disabled={!enrichInstructions.trim() || enrichMutation.isPending}
              onClick={() => enrichMutation.mutate({ id: chunk.id, instructions: enrichInstructions })}
            >
              {enrichMutation.isPending ? "Enriching..." : "Enrich"}
            </button>
          </div>
        </div>
      )}

      {/* Status banners */}
      {chunk.enrich_status === "enriching" && (
        <div style={{
          background: "var(--bg2)", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", padding: "0.75rem 1rem",
          color: "var(--amber)", fontSize: 13, marginBottom: "1rem",
        }}>
          Claude Haiku is enriching this lecture...
        </div>
      )}
      {chunk.enrich_status === "pending" && (
        <div style={{
          background: "var(--bg2)", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", padding: "0.75rem 1rem",
          color: "var(--text2)", fontSize: 13, marginBottom: "1rem",
        }}>
          Queued for enrichment — ready shortly.
        </div>
      )}

      {/* Sections — flat display */}
      {chunk.sections.length > 0 ? (
        <div>
          {chunk.sections.map((section, idx) => (
            <SectionBlock
              key={section.section_key}
              section={section}
              images={getImagesForSection(
                idx, chunk.sections.length,
                chunk.images, chunk.page_start, chunk.page_end
              )}
              onToggleComplete={(id, current) => onSectionComplete(id, !current)}
            />
          ))}
        </div>
      ) : chunk.enriched_md ? (
        <MarkdownBody md={chunk.enriched_md} />
      ) : chunk.enrich_status === "failed" ? (
        <div style={{ color: "var(--red)", fontSize: 13 }}>
          Enrichment failed. Click "Enrich with Sonnet" to retry.
        </div>
      ) : null}
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function StudyCanvasPage() {
  const qc = useQueryClient();
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [selectedChunkId, setSelectedChunkId] = useState<number | null>(null);
  const [showEnrichPanel, setShowEnrichPanel] = useState(false);
  const [multiSelect, setMultiSelect] = useState<Set<number>>(new Set());
  const [focusMode, setFocusMode] = useState(false);
  const [focusChunkIds, setFocusChunkIds] = useState<number[]>([]);
  const [resumeSession, setResumeSession] = useState<FocusSession | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingScrollSection, setPendingScrollSection] = useState<number | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const { data: courses = [], isLoading: coursesLoading } = useQuery({
    queryKey: ["canvas-courses"],
    queryFn: fetchCanvasCourses,
    refetchInterval: (query) => {
      const data = query.state.data as CanvasCourse[] | undefined;
      return data?.some((c) => c.enriched_chunks < c.total_chunks) ? 8000 : false;
    },
  });

  const { data: chunks = [] } = useQuery({
    queryKey: ["canvas-chunks", selectedCourse],
    queryFn: () => fetchCanvasChunks(selectedCourse!),
    enabled: !!selectedCourse,
    refetchInterval: (query) => {
      const data = query.state.data as CanvasChunkSummary[] | undefined;
      return data?.some((c) => c.enrich_status === "pending" || c.enrich_status === "enriching") ? 4000 : false;
    },
  });

  const { data: chunk, isLoading: chunkLoading } = useQuery({
    queryKey: ["canvas-chunk", selectedChunkId],
    queryFn: () => fetchCanvasChunk(selectedChunkId!),
    enabled: !!selectedChunkId,
    refetchInterval: (query) =>
      (query.state.data as CanvasChunk | undefined)?.enrich_status === "enriching" ? 3000 : false,
  });

  const { data: searchResults = [] } = useQuery<SearchResult[]>({
    queryKey: ["section-search", searchQuery, selectedCourse],
    queryFn: () => searchSections(searchQuery, selectedCourse ?? undefined),
    enabled: searchQuery.trim().length >= 2,
    staleTime: 10_000,
  });

  // Close search dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Scroll to section after chunk loads
  useEffect(() => {
    if (chunk && pendingScrollSection !== null) {
      const el = document.getElementById(`section-${pendingScrollSection}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        setPendingScrollSection(null);
      }
    }
  }, [chunk, pendingScrollSection]);

  const ingestMutation = useMutation({
    mutationFn: triggerHandoutIngest,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["canvas-courses"] }),
  });

  const chunkCompleteMutation = useMutation({
    mutationFn: ({ id, done }: { id: number; done: boolean }) => setChunkCompletion(id, done),
    onMutate: async ({ id, done }) => {
      // Optimistic update in chunk list
      await qc.cancelQueries({ queryKey: ["canvas-chunks", selectedCourse] });
      const prev = qc.getQueryData<CanvasChunkSummary[]>(["canvas-chunks", selectedCourse]);
      if (prev) {
        qc.setQueryData<CanvasChunkSummary[]>(["canvas-chunks", selectedCourse],
          prev.map((c) => c.id === id ? { ...c, is_completed: done } : c));
      }
      // Also update reading pane
      const prevChunk = qc.getQueryData<CanvasChunk>(["canvas-chunk", id]);
      if (prevChunk) {
        qc.setQueryData<CanvasChunk>(["canvas-chunk", id], { ...prevChunk, is_completed: done });
      }
      return { prev, prevChunk };
    },
    onError: (_e, { id }, ctx) => {
      if (ctx?.prev) qc.setQueryData(["canvas-chunks", selectedCourse], ctx.prev);
      if (ctx?.prevChunk) qc.setQueryData(["canvas-chunk", id], ctx.prevChunk);
    },
  });

  const sectionCompleteMutation = useMutation({
    mutationFn: ({ id, done }: { id: number; done: boolean }) => setSectionCompletion(id, done),
    onMutate: async ({ id, done }) => {
      await qc.cancelQueries({ queryKey: ["canvas-chunk", selectedChunkId] });
      const prev = qc.getQueryData<CanvasChunk>(["canvas-chunk", selectedChunkId]);
      if (prev) {
        qc.setQueryData<CanvasChunk>(["canvas-chunk", selectedChunkId], {
          ...prev,
          sections: prev.sections.map((s) => s.id === id ? { ...s, is_completed: done } : s),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["canvas-chunk", selectedChunkId], ctx.prev);
    },
  });

  // Cross-page navigation hints
  useEffect(() => {
    if (courses.length === 0) return;
    const hint = sessionStorage.getItem("canvas_select_course");
    if (hint) {
      sessionStorage.removeItem("canvas_select_course");
      if (courses.find((c) => c.course_code === hint)) {
        setSelectedCourse(hint);
        return;
      }
    }
    if (!selectedCourse) setSelectedCourse(courses[0].course_code);
  }, [courses]);

  useEffect(() => {
    if (selectedCourse) { setSelectedChunkId(null); setMultiSelect(new Set()); }
  }, [selectedCourse]);

  useEffect(() => {
    if (chunks.length === 0) return;

    // Focus mode hint from Study Plan / Playground
    const focusHint = sessionStorage.getItem("canvas_focus_chunks");
    if (focusHint) {
      sessionStorage.removeItem("canvas_focus_chunks");
      const ids: number[] = JSON.parse(focusHint);
      const valid = ids.filter((id) => chunks.find((c) => c.id === id));
      if (valid.length > 0) {
        setFocusChunkIds(valid);
        setResumeSession(null);
        setFocusMode(true);
        return;
      }
    }

    const hint = sessionStorage.getItem("canvas_select_chunk");
    if (hint) {
      const id = parseInt(hint, 10);
      if (chunks.find((c) => c.id === id)) {
        sessionStorage.removeItem("canvas_select_chunk");
        setSelectedChunkId(id);
        return;
      }
    }
    if (!selectedChunkId) setSelectedChunkId(chunks[0].id);
  }, [chunks]);

  const courseProgress = selectedCourse ? courses.find((c) => c.course_code === selectedCourse) : null;

  // Course-level completion: % of completed chunks
  function courseCompletionPct(course: CanvasCourse) {
    // We only have enriched_chunks/total_chunks from the summary; chunk completion
    // would need a different endpoint. For now show enrichment progress only.
    return course.total_chunks > 0
      ? Math.round((course.enriched_chunks / course.total_chunks) * 100)
      : 0;
  }

  // Focus Mode overlay
  if (focusMode && focusChunkIds.length > 0 && selectedCourse) {
    return (
      <FocusMode
        courseCode={selectedCourse}
        initialChunkIds={focusChunkIds}
        existingSession={resumeSession}
        onExit={() => { setFocusMode(false); setMultiSelect(new Set()); }}
      />
    );
  }

  return (
    <div className="page" style={{ maxWidth: "none", padding: 0, height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{
        padding: "0.9rem 2rem", borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 16, flexShrink: 0,
      }}>
        <div style={{ flexShrink: 0 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Study Canvas</h1>
        </div>

        {/* Search bar */}
        <div ref={searchRef} style={{ flex: 1, maxWidth: 400, position: "relative" }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            placeholder={selectedCourse ? `Search ${selectedCourse} sections…` : "Search sections…"}
            style={{
              width: "100%", background: "var(--bg3)", border: "1px solid var(--border)",
              borderRadius: "var(--radius)", color: "var(--text)", padding: "6px 32px 6px 12px",
              fontSize: 13, boxSizing: "border-box",
            }}
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(""); setSearchOpen(false); }}
              style={{
                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", cursor: "pointer",
                color: "var(--text3)", fontSize: 14, lineHeight: 1,
              }}
            >✕</button>
          )}

          {/* Results dropdown */}
          {searchOpen && searchQuery.trim().length >= 2 && searchResults.length > 0 && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
              background: "var(--bg2)", border: "1px solid var(--border)",
              borderRadius: "var(--radius)", boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
              zIndex: 200, maxHeight: 360, overflowY: "auto",
            }}>
              {searchResults.map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    setSelectedCourse(r.course_code);
                    setSelectedChunkId(r.chunk_id);
                    setPendingScrollSection(r.id);
                    setSearchOpen(false);
                    setSearchQuery("");
                  }}
                  style={{
                    width: "100%", textAlign: "left", background: "none", border: "none",
                    padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid var(--border)",
                    display: "block",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg3)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                      {r.title}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--text3)", flexShrink: 0 }}>
                      {r.course_code} · {r.chunk_title.slice(0, 40)}
                    </span>
                  </div>
                  {r.body_snippet && (
                    <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.4 }}>
                      {r.body_snippet.slice(0, 120)}…
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
          {searchOpen && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
              background: "var(--bg2)", border: "1px solid var(--border)",
              borderRadius: "var(--radius)", padding: "10px 12px",
              fontSize: 12, color: "var(--text3)", zIndex: 200,
            }}>
              No results
            </div>
          )}
        </div>

        <button
          className="btn btn--ghost"
          style={{ fontSize: 12, padding: "0.4rem 0.9rem", flexShrink: 0 }}
          onClick={() => ingestMutation.mutate()}
          disabled={ingestMutation.isPending}
        >
          {ingestMutation.isPending ? "Scanning..." : "Re-scan Handouts"}
        </button>
      </div>

      {/* Three-panel layout */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Panel 1: Course list */}
        <div style={{
          width: 180, minWidth: 180, borderRight: "1px solid var(--border)",
          overflowY: "auto", padding: "0.75rem 0",
        }}>
          {coursesLoading && <div style={{ padding: "1rem", color: "var(--text3)", fontSize: 13 }}>Loading...</div>}
          {!coursesLoading && courses.length === 0 && (
            <div style={{ padding: "1rem", color: "var(--text3)", fontSize: 13 }}>
              No handouts.<br />Drop PDFs into handouts/
            </div>
          )}
          {courses.map((c) => {
            const active = selectedCourse === c.course_code;
            const pct = courseCompletionPct(c);
            return (
              <button
                key={c.course_code}
                onClick={() => { setSelectedCourse(c.course_code); setSelectedChunkId(null); }}
                style={{
                  width: "100%", textAlign: "left", padding: "0.65rem 1rem",
                  background: active ? "var(--bg3)" : "transparent", border: "none",
                  borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
                  color: active ? "var(--text)" : "var(--text2)",
                  cursor: "pointer", fontSize: 13, fontWeight: active ? 600 : 400,
                }}
              >
                <div style={{ marginBottom: 4 }}>{c.course_code}</div>
                {/* Enrichment bar doubles as visual progress */}
                <div style={{ height: 2, background: "var(--bg3)", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", width: `${pct}%`,
                    background: pct === 100 ? "var(--green)" : "var(--accent)",
                    borderRadius: 99, transition: "width 0.3s",
                  }} />
                </div>
              </button>
            );
          })}
        </div>

        {/* Panel 2: Lecture list */}
        <div style={{
          width: 260, minWidth: 260, borderRight: "1px solid var(--border)",
          overflowY: "auto", padding: "0.75rem 0", display: "flex", flexDirection: "column",
        }}>
          {/* Enrichment progress + Focus button */}
          {courseProgress && (
            <div style={{ padding: "0.5rem 1rem 0.75rem", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 11, color: "var(--text3)" }}>
                  {courseProgress.enriched_chunks} / {courseProgress.total_chunks} enriched
                </span>
                {multiSelect.size > 0 && (
                  <button
                    className="btn"
                    style={{ fontSize: 11, padding: "3px 10px" }}
                    onClick={() => {
                      const ids = Array.from(multiSelect);
                      setFocusChunkIds(ids);
                      setResumeSession(null);
                      setFocusMode(true);
                    }}
                  >
                    Focus {multiSelect.size} →
                  </button>
                )}
              </div>
              <div style={{ height: 3, background: "var(--bg3)", borderRadius: 99, overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: `${courseProgress.total_chunks > 0 ? (courseProgress.enriched_chunks / courseProgress.total_chunks) * 100 : 0}%`,
                  background: "var(--green)", borderRadius: 99, transition: "width 0.3s",
                }} />
              </div>
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto" }}>
            {chunks.map((c) => {
              const active = selectedChunkId === c.id;
              const selected = multiSelect.has(c.id);
              return (
                <div
                  key={c.id}
                  style={{
                    display: "flex", alignItems: "stretch",
                    borderLeft: active ? "2px solid var(--accent)" : selected ? "2px solid var(--amber)" : "2px solid transparent",
                    background: active ? "var(--bg3)" : selected ? "rgba(245,158,11,0.06)" : "transparent",
                  }}
                >
                  {/* Multi-select checkbox */}
                  <div
                    style={{ display: "flex", alignItems: "center", padding: "0 4px 0 8px", cursor: "pointer" }}
                    onClick={() => {
                      setMultiSelect((prev) => {
                        const next = new Set(prev);
                        next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                        return next;
                      });
                    }}
                  >
                    <div style={{
                      width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                      border: `2px solid ${selected ? "var(--amber)" : "var(--border2)"}`,
                      background: selected ? "var(--amber)" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "all 0.12s",
                    }}>
                      {selected && (
                        <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                  </div>

                  {/* Completion tick */}
                  <div style={{ display: "flex", alignItems: "center", paddingRight: 4 }}>
                    <Tick
                      done={c.is_completed}
                      onToggle={() => chunkCompleteMutation.mutate({ id: c.id, done: !c.is_completed })}
                      size={13}
                    />
                  </div>

                  {/* Clickable text */}
                  <button
                    onClick={() => { setSelectedChunkId(c.id); setShowEnrichPanel(false); }}
                    style={{
                      flex: 1, textAlign: "left", padding: "0.6rem 0.75rem 0.6rem 4px",
                      background: "none", border: "none", cursor: "pointer",
                      fontSize: 13,
                      textDecoration: c.is_completed ? "line-through" : "none",
                      color: c.is_completed ? "var(--text3)" : "var(--text)",
                    } as React.CSSProperties}
                  >
                    <div style={{ fontWeight: active ? 600 : 400, marginBottom: 3 }}>
                      {c.title}
                    </div>
                    <StatusBadge status={c.enrich_status} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Panel 3: Reading pane */}
        <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem 2rem" }}>
          {!selectedChunkId && (
            <div style={{ color: "var(--text3)", fontSize: 14, marginTop: "4rem", textAlign: "center" }}>
              Select a lecture to read
            </div>
          )}
          {chunkLoading && selectedChunkId && (
            <div style={{ color: "var(--text3)", fontSize: 14 }}>Loading...</div>
          )}
          {chunk && (
            <ReadingPane
              chunk={chunk}
              showEnrichPanel={showEnrichPanel}
              setShowEnrichPanel={setShowEnrichPanel}
              onChunkComplete={(done) => chunkCompleteMutation.mutate({ id: chunk.id, done })}
              onSectionComplete={(id, done) => sectionCompleteMutation.mutate({ id, done })}
            />
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.7); }
        }
        .canvas-md h1 { font-size: 1.25rem; font-weight: 700; margin: 1rem 0 0.4rem; color: var(--text); }
        .canvas-md h2 { font-size: 1rem; font-weight: 700; margin: 0.9rem 0 0.3rem; color: var(--text); border-bottom: 1px solid var(--border); padding-bottom: 0.2rem; }
        .canvas-md h3 { font-size: 0.9rem; font-weight: 600; margin: 0.7rem 0 0.25rem; color: var(--accent); }
        .canvas-md p { margin: 0.4rem 0; color: var(--text2); line-height: 1.75; font-size: 14px; }
        .canvas-md ul { margin: 0.3rem 0 0.3rem 1.3rem; }
        .canvas-md li { color: var(--text2); font-size: 14px; margin: 0.15rem 0; }
        .canvas-md strong { color: var(--text); font-weight: 600; }
        .canvas-md em { color: var(--text3); font-style: italic; }
        .canvas-md code { font-family: var(--font-mono); background: var(--bg3); padding: 0.1em 0.35em; border-radius: 4px; font-size: 12px; color: var(--cyan); }
        .canvas-md pre { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.7rem 1rem; margin: 0.5rem 0; overflow-x: auto; }
        .canvas-md pre code { background: none; padding: 0; font-size: 13px; color: var(--text); }
        .canvas-md hr { border: none; border-top: 1px solid var(--border); margin: 0.8rem 0; }
      `}</style>
    </div>
  );
}
