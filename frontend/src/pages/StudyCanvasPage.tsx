import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchCanvasCourses,
  fetchCanvasChunks,
  fetchCanvasChunk,
  enrichWithSonnet,
  setChunkCompletion,
  setSectionCompletion,
  triggerHandoutIngest,
  CanvasCourse,
  CanvasChunkSummary,
  CanvasChunk,
  CanvasSection,
  CanvasImage,
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

// ── Inline image strip ─────────────────────────────────────────────────────────

function ImageStrip({ images }: { images: CanvasImage[] }) {
  if (!images.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "10px 0 4px" }}>
      {images.map((img) => (
        <img
          key={img.seq}
          src={`http://localhost:8000${img.url}`}
          alt={`Figure ${img.seq}`}
          style={{
            maxWidth: 280, maxHeight: 200, objectFit: "contain",
            border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
            background: "var(--bg2)", cursor: "zoom-in",
          }}
          onClick={() => window.open(`http://localhost:8000${img.url}`, "_blank")}
        />
      ))}
    </div>
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

// ── Section block ───────────────────────────────────────────────────────────────

function SectionBlock({
  section,
  images,
  defaultOpen,
  onToggleComplete,
}: {
  section: CanvasSection;
  images: CanvasImage[];
  defaultOpen: boolean;
  onToggleComplete: (id: number, current: boolean) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isSubsection = section.level >= 2;

  return (
    <div style={{
      borderLeft: `2px solid ${section.is_completed ? "var(--green)" : isSubsection ? "var(--border)" : "var(--accent)"}`,
      marginBottom: isSubsection ? 4 : 10,
      background: section.is_completed ? "rgba(72,199,120,0.04)" : "transparent",
      borderRadius: "0 var(--radius-sm) var(--radius-sm) 0",
      transition: "background 0.2s",
    }}>
      {/* Section header */}
      <button
        onClick={() => setOpen((x) => !x)}
        style={{
          width: "100%", textAlign: "left", background: "none", border: "none",
          padding: isSubsection ? "6px 10px" : "10px 12px",
          cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
        }}
      >
        <Tick
          done={section.is_completed}
          onToggle={() => onToggleComplete(section.id, section.is_completed)}
          size={isSubsection ? 14 : 16}
        />
        <span style={{
          flex: 1,
          fontSize: isSubsection ? 13 : 14,
          fontWeight: isSubsection ? 500 : 700,
          color: section.is_completed ? "var(--text3)" : "var(--text)",
          textDecoration: section.is_completed ? "line-through" : "none",
        }}>
          {section.title}
        </span>
        {images.length > 0 && (
          <span style={{ fontSize: 10, color: "var(--text3)" }}>
            {images.length} fig{images.length > 1 ? "s" : ""}
          </span>
        )}
        <span style={{ fontSize: 10, color: "var(--text3)" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: isSubsection ? "0 10px 8px 36px" : "0 12px 10px 36px" }}>
          <MarkdownBody md={section.body} />
          <ImageStrip images={images} />
        </div>
      )}
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

  // Distribute images to sections proportionally by page
  const totalPages = chunk.page_end - chunk.page_start + 1;
  const numSections = chunk.sections.length || 1;

  function imagesForSection(idx: number): CanvasImage[] {
    if (!chunk.images.length) return [];
    const secPageStart = chunk.page_start + Math.floor((idx / numSections) * totalPages);
    const secPageEnd = chunk.page_start + Math.floor(((idx + 1) / numSections) * totalPages) - 1;
    return chunk.images.filter((img) => img.page_no >= secPageStart && img.page_no <= secPageEnd);
  }

  const completedCount = chunk.sections.filter((s) => s.is_completed).length;
  const completionPct = chunk.sections.length > 0
    ? Math.round((completedCount / chunk.sections.length) * 100) : 0;

  return (
    <>
      {/* Header */}
      <div style={{ marginBottom: "1.2rem" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
            <Tick done={chunk.is_completed} onToggle={() => onChunkComplete(!chunk.is_completed)} size={20} />
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "var(--text)" }}>
                {chunk.title}
              </h2>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
                <StatusBadge status={chunk.enrich_status} />
                <span style={{ fontSize: 11, color: "var(--text3)" }}>
                  Pages {chunk.page_start + 1}–{chunk.page_end + 1}
                </span>
                {chunk.sections.length > 0 && (
                  <span style={{ fontSize: 11, color: completionPct === 100 ? "var(--green)" : "var(--text3)" }}>
                    {completedCount}/{chunk.sections.length} sections
                  </span>
                )}
              </div>
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
        {chunk.sections.length > 0 && (
          <div style={{ height: 3, background: "var(--bg3)", borderRadius: 99, overflow: "hidden", marginTop: 10 }}>
            <div style={{
              height: "100%", width: `${completionPct}%`,
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
          Queued for Haiku enrichment — ready shortly.
        </div>
      )}

      {/* Sections */}
      {chunk.sections.length > 0 ? (
        <div>
          {chunk.sections.map((section, idx) => (
            <SectionBlock
              key={section.section_key}
              section={section}
              images={imagesForSection(idx)}
              defaultOpen={idx === 0}
              onToggleComplete={(id, current) => onSectionComplete(id, !current)}
            />
          ))}
        </div>
      ) : chunk.enriched_md ? (
        // Fallback: raw markdown if no sections parsed yet
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

  const ingestMutation = useMutation({
    mutationFn: triggerHandoutIngest,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["canvas-courses"] }),
  });

  const chunkCompleteMutation = useMutation({
    mutationFn: ({ id, done }: { id: number; done: boolean }) => setChunkCompletion(id, done),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["canvas-chunk", selectedChunkId] });
      qc.invalidateQueries({ queryKey: ["canvas-chunks", selectedCourse] });
    },
  });

  const sectionCompleteMutation = useMutation({
    mutationFn: ({ id, done }: { id: number; done: boolean }) => setSectionCompletion(id, done),
    onMutate: async ({ id, done }) => {
      // Optimistic update
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
    if (selectedCourse) setSelectedChunkId(null);
  }, [selectedCourse]);

  useEffect(() => {
    if (chunks.length === 0) return;
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

  return (
    <div className="page" style={{ maxWidth: "none", padding: 0, height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{
        padding: "1.25rem 2rem 0.9rem", borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
      }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Study Canvas</h1>
          <p style={{ color: "var(--text2)", fontSize: 13, marginTop: 2 }}>
            Lecture handouts — section by section
          </p>
        </div>
        <button
          className="btn btn--ghost"
          style={{ fontSize: 12, padding: "0.4rem 0.9rem" }}
          onClick={() => ingestMutation.mutate()}
          disabled={ingestMutation.isPending}
        >
          {ingestMutation.isPending ? "Scanning..." : "Re-scan Handouts"}
        </button>
      </div>

      {/* Three-panel layout */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Course list */}
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
          {courses.map((c) => (
            <button
              key={c.course_code}
              onClick={() => { setSelectedCourse(c.course_code); setSelectedChunkId(null); }}
              style={{
                width: "100%", textAlign: "left", padding: "0.65rem 1rem",
                background: selectedCourse === c.course_code ? "var(--bg3)" : "transparent",
                border: "none",
                borderLeft: selectedCourse === c.course_code ? "2px solid var(--accent)" : "2px solid transparent",
                color: selectedCourse === c.course_code ? "var(--text)" : "var(--text2)",
                cursor: "pointer", fontSize: 13,
                fontWeight: selectedCourse === c.course_code ? 600 : 400,
              }}
            >
              <div>{c.course_code}</div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                {c.enriched_chunks}/{c.total_chunks} ready
              </div>
            </button>
          ))}
        </div>

        {/* Lecture list */}
        <div style={{
          width: 260, minWidth: 260, borderRight: "1px solid var(--border)",
          overflowY: "auto", padding: "0.75rem 0",
        }}>
          {courseProgress && (
            <div style={{ padding: "0.5rem 1rem 0.75rem", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 5 }}>
                {courseProgress.enriched_chunks} / {courseProgress.total_chunks} enriched
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
          {chunks.map((c) => (
            <button
              key={c.id}
              onClick={() => { setSelectedChunkId(c.id); setShowEnrichPanel(false); }}
              style={{
                width: "100%", textAlign: "left", padding: "0.65rem 1rem",
                background: selectedChunkId === c.id ? "var(--bg3)" : "transparent",
                border: "none",
                borderLeft: selectedChunkId === c.id ? "2px solid var(--accent)" : "2px solid transparent",
                color: "var(--text)", cursor: "pointer", fontSize: 13,
              }}
            >
              <div style={{ fontWeight: selectedChunkId === c.id ? 600 : 400, marginBottom: 3 }}>
                {c.title}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <StatusBadge status={c.enrich_status} />
                {c.image_count > 0 && (
                  <span style={{ fontSize: 11, color: "var(--text3)" }}>{c.image_count} img</span>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Reading pane */}
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
        .canvas-md h1 { font-size: 1.3rem; font-weight: 700; margin: 1rem 0 0.4rem; color: var(--text); }
        .canvas-md h2 { font-size: 1.05rem; font-weight: 700; margin: 0.9rem 0 0.35rem; color: var(--text); border-bottom: 1px solid var(--border); padding-bottom: 0.2rem; }
        .canvas-md h3 { font-size: 0.92rem; font-weight: 600; margin: 0.7rem 0 0.25rem; color: var(--accent); }
        .canvas-md p { margin: 0.45rem 0; color: var(--text); line-height: 1.7; font-size: 14px; }
        .canvas-md ul { margin: 0.3rem 0 0.3rem 1.3rem; }
        .canvas-md li { color: var(--text); font-size: 14px; margin: 0.15rem 0; }
        .canvas-md strong { color: var(--text); font-weight: 600; }
        .canvas-md em { color: var(--text2); font-style: italic; }
        .canvas-md code { font-family: var(--font-mono); background: var(--bg3); padding: 0.1em 0.35em; border-radius: 4px; font-size: 12px; color: var(--cyan); }
        .canvas-md pre { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.7rem 1rem; margin: 0.5rem 0; overflow-x: auto; }
        .canvas-md pre code { background: none; padding: 0; font-size: 13px; color: var(--text); }
        .canvas-md hr { border: none; border-top: 1px solid var(--border); margin: 0.7rem 0; }
      `}</style>
    </div>
  );
}
