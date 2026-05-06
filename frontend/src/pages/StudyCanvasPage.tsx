import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchCanvasCourses,
  fetchCanvasChunks,
  fetchCanvasChunk,
  enrichWithSonnet,
  triggerHandoutIngest,
  CanvasCourse,
  CanvasChunkSummary,
  CanvasChunk,
} from "../api/client";

const STATUS_COLOR: Record<string, string> = {
  done: "var(--green)",
  enriching: "var(--amber)",
  pending: "var(--text3)",
  failed: "var(--red)",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: "0.04em",
      color: STATUS_COLOR[status] ?? "var(--text3)",
      textTransform: "uppercase",
    }}>
      {status}
    </span>
  );
}

function MarkdownBody({ md }: { md: string }) {
  // Simple markdown renderer without external deps
  const html = md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/^```[\w]*\n([\s\S]*?)^```/gm, "<pre><code>$1</code></pre>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]+?<\/li>)/g, "<ul>$1</ul>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/^(?!<[h|u|p|l|c|p])/gm, "");

  return (
    <div
      className="canvas-md"
      dangerouslySetInnerHTML={{ __html: `<p>${html}</p>` }}
    />
  );
}

export function StudyCanvasPage() {
  const qc = useQueryClient();
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [selectedChunkId, setSelectedChunkId] = useState<number | null>(null);
  const [enrichInstructions, setEnrichInstructions] = useState("");
  const [showEnrichPanel, setShowEnrichPanel] = useState(false);
  const { data: courses = [], isLoading: coursesLoading } = useQuery({
    queryKey: ["canvas-courses"],
    queryFn: fetchCanvasCourses,
  });

  const { data: chunks = [] } = useQuery({
    queryKey: ["canvas-chunks", selectedCourse],
    queryFn: () => fetchCanvasChunks(selectedCourse!),
    enabled: !!selectedCourse,
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

  const enrichMutation = useMutation({
    mutationFn: ({ id, instructions }: { id: number; instructions: string }) =>
      enrichWithSonnet(id, instructions),
    onSuccess: () => {
      setShowEnrichPanel(false);
      setEnrichInstructions("");
      qc.invalidateQueries({ queryKey: ["canvas-chunk", selectedChunkId] });
    },
  });

  // Auto-select first course
  useEffect(() => {
    if (courses.length > 0 && !selectedCourse) {
      setSelectedCourse(courses[0].course_code);
    }
  }, [courses, selectedCourse]);

  // Auto-select first chunk
  useEffect(() => {
    if (chunks.length > 0 && !selectedChunkId) {
      setSelectedChunkId(chunks[0].id);
    }
    if (selectedCourse) setSelectedChunkId(null);
  }, [selectedCourse]);

  function handleCourseSelect(code: string) {
    setSelectedCourse(code);
    setSelectedChunkId(null);
  }

  const progress = selectedCourse
    ? courses.find((c) => c.course_code === selectedCourse)
    : null;

  return (
    <div className="page" style={{ maxWidth: "none", padding: 0, height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{
        padding: "1.5rem 2rem 1rem",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Study Canvas</h1>
          <p style={{ color: "var(--text2)", fontSize: 13, marginTop: 2 }}>
            Lecture handouts enriched with first-principles notes
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
        {/* Panel 1: Courses */}
        <div style={{
          width: 180,
          minWidth: 180,
          borderRight: "1px solid var(--border)",
          overflowY: "auto",
          padding: "0.75rem 0",
        }}>
          {coursesLoading && (
            <div style={{ padding: "1rem", color: "var(--text3)", fontSize: 13 }}>Loading...</div>
          )}
          {!coursesLoading && courses.length === 0 && (
            <div style={{ padding: "1rem", color: "var(--text3)", fontSize: 13 }}>
              No handouts found.<br />Drop PDFs into handouts/
            </div>
          )}
          {courses.map((c) => (
            <button
              key={c.course_code}
              onClick={() => handleCourseSelect(c.course_code)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "0.65rem 1rem",
                background: selectedCourse === c.course_code ? "var(--bg3)" : "transparent",
                border: "none",
                borderLeft: selectedCourse === c.course_code ? "2px solid var(--accent)" : "2px solid transparent",
                color: selectedCourse === c.course_code ? "var(--text)" : "var(--text2)",
                cursor: "pointer",
                fontSize: 13,
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

        {/* Panel 2: Chunk list */}
        <div style={{
          width: 260,
          minWidth: 260,
          borderRight: "1px solid var(--border)",
          overflowY: "auto",
          padding: "0.75rem 0",
        }}>
          {progress && (
            <div style={{ padding: "0.5rem 1rem 0.75rem", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>
                {progress.enriched_chunks} of {progress.total_chunks} enriched
              </div>
              <div style={{
                height: 4,
                background: "var(--bg3)",
                borderRadius: 99,
                overflow: "hidden",
              }}>
                <div style={{
                  height: "100%",
                  width: `${progress.total_chunks > 0 ? (progress.enriched_chunks / progress.total_chunks) * 100 : 0}%`,
                  background: "var(--green)",
                  borderRadius: 99,
                  transition: "width 0.3s",
                }} />
              </div>
            </div>
          )}

          {chunks.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedChunkId(c.id)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "0.65rem 1rem",
                background: selectedChunkId === c.id ? "var(--bg3)" : "transparent",
                border: "none",
                borderLeft: selectedChunkId === c.id ? "2px solid var(--accent)" : "2px solid transparent",
                color: "var(--text)",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              <div style={{ fontWeight: selectedChunkId === c.id ? 600 : 400, marginBottom: 3 }}>
                {c.title}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <StatusBadge status={c.enrich_status} />
                {c.image_count > 0 && (
                  <span style={{ fontSize: 11, color: "var(--text3)" }}>
                    {c.image_count} img
                  </span>
                )}
              </div>
            </button>
          ))}
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
            <>
              {/* Chunk header */}
              <div style={{ marginBottom: "1.5rem", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{chunk.title}</h2>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <StatusBadge status={chunk.enrich_status} />
                    {chunk.enriched_at && (
                      <span style={{ fontSize: 11, color: "var(--text3)" }}>
                        Enriched {new Date(chunk.enriched_at).toLocaleDateString()}
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: "var(--text3)" }}>
                      Pages {chunk.page_start + 1}–{chunk.page_end + 1}
                    </span>
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

              {/* Sonnet enrichment panel */}
              {showEnrichPanel && (
                <div style={{
                  background: "var(--bg2)",
                  border: "1px solid var(--border2)",
                  borderRadius: "var(--radius)",
                  padding: "1rem",
                  marginBottom: "1.5rem",
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                    Enrich with Claude Sonnet
                  </div>
                  <textarea
                    value={enrichInstructions}
                    onChange={(e) => setEnrichInstructions(e.target.value)}
                    placeholder="e.g. Explain with Python examples. Add references to GeeksForGeeks. Make it simpler."
                    style={{
                      width: "100%",
                      minHeight: 80,
                      background: "var(--bg3)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      color: "var(--text)",
                      padding: "0.6rem 0.8rem",
                      fontSize: 13,
                      fontFamily: "var(--font)",
                      resize: "vertical",
                    }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
                    <button
                      className="btn btn--ghost"
                      style={{ fontSize: 12 }}
                      onClick={() => setShowEnrichPanel(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn"
                      style={{ fontSize: 12 }}
                      disabled={!enrichInstructions.trim() || enrichMutation.isPending}
                      onClick={() =>
                        enrichMutation.mutate({ id: chunk.id, instructions: enrichInstructions })
                      }
                    >
                      {enrichMutation.isPending ? "Enriching..." : "Enrich"}
                    </button>
                  </div>
                </div>
              )}

              {/* Status states */}
              {chunk.enrich_status === "enriching" && (
                <div style={{
                  background: "var(--bg2)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  padding: "1rem",
                  color: "var(--amber)",
                  fontSize: 13,
                  marginBottom: "1rem",
                }}>
                  Claude Haiku is enriching this lecture... Refresh in a moment.
                </div>
              )}

              {chunk.enrich_status === "pending" && (
                <div style={{
                  background: "var(--bg2)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  padding: "1rem",
                  color: "var(--text2)",
                  fontSize: 13,
                  marginBottom: "1rem",
                }}>
                  This lecture is queued for Haiku enrichment and will be ready shortly.
                </div>
              )}

              {/* Images */}
              {chunk.images.length > 0 && (
                <div style={{ marginBottom: "1.5rem" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text3)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Figures from source ({chunk.images.length})
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                    {chunk.images.map((img) => (
                      <img
                        key={img.seq}
                        src={`http://localhost:8000${img.url}`}
                        alt={`Figure ${img.seq}`}
                        style={{
                          maxWidth: 320,
                          maxHeight: 240,
                          objectFit: "contain",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          background: "var(--bg2)",
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Enriched notes */}
              {chunk.enriched_md ? (
                <MarkdownBody md={chunk.enriched_md} />
              ) : chunk.enrich_status === "failed" ? (
                <div style={{ color: "var(--red)", fontSize: 13 }}>
                  Enrichment failed. Click "Enrich with Sonnet" to retry with custom instructions.
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <style>{`
        .canvas-md h1 { font-size: 1.4rem; font-weight: 700; margin: 1.2rem 0 0.5rem; color: var(--text); }
        .canvas-md h2 { font-size: 1.1rem; font-weight: 700; margin: 1rem 0 0.4rem; color: var(--text); border-bottom: 1px solid var(--border); padding-bottom: 0.25rem; }
        .canvas-md h3 { font-size: 0.95rem; font-weight: 600; margin: 0.8rem 0 0.3rem; color: var(--accent); }
        .canvas-md p { margin: 0.5rem 0; color: var(--text); line-height: 1.7; font-size: 14px; }
        .canvas-md ul { margin: 0.4rem 0 0.4rem 1.4rem; }
        .canvas-md li { color: var(--text); font-size: 14px; margin: 0.2rem 0; }
        .canvas-md strong { color: var(--text); font-weight: 600; }
        .canvas-md em { color: var(--text2); font-style: italic; }
        .canvas-md code { font-family: var(--font-mono); background: var(--bg3); padding: 0.1em 0.4em; border-radius: 4px; font-size: 12px; color: var(--cyan); }
        .canvas-md pre { background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.75rem 1rem; margin: 0.6rem 0; overflow-x: auto; }
        .canvas-md pre code { background: none; padding: 0; font-size: 13px; color: var(--text); }
      `}</style>
    </div>
  );
}
