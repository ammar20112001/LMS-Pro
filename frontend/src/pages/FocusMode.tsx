import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchFocusChunks,
  setSectionCompletion,
  setChunkCompletion,
  addNote,
  updateNote,
  deleteNote,
  generateResources,
  deleteResource,
  uploadScreenshot,
  deleteScreenshot,
  updateScreenshotCaption,
  getChatMessages,
  sendChatMessage,
  deleteChatMessage,
  listFocusSessions,
  createFocusSession,
  updateFocusSession,
  FocusChunk,
  FocusSection,
  SectionNote,
  FocusSession,
  CanvasImage,
  ExternalResource,
  SectionScreenshot,
  ChatMessage,
} from "../api/client";

// ── Utilities ──────────────────────────────────────────────────────────────────

function fmtTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
  return <div className="canvas-md" dangerouslySetInnerHTML={{ __html: `<p>${html}</p>` }} />;
}

function ImageStrip({ images }: { images: CanvasImage[] }) {
  if (!images.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "12px 0" }}>
      {images.map((img) => (
        <img
          key={img.seq}
          src={`http://localhost:8000${img.url}`}
          alt={`Figure ${img.seq}`}
          style={{
            maxWidth: 320, maxHeight: 240, objectFit: "contain",
            border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
            background: "var(--bg2)", cursor: "zoom-in",
          }}
          onClick={() => window.open(`http://localhost:8000${img.url}`, "_blank")}
        />
      ))}
    </div>
  );
}

function getImagesForSection(idx: number, total: number, images: CanvasImage[], pageStart: number, pageEnd: number): CanvasImage[] {
  if (!images.length || total === 0) return [];
  const totalPages = pageEnd - pageStart + 1;
  const located = images.filter((img) => img.page_no >= pageStart && img.page_no <= pageEnd);
  const legacy = images.filter((img) => img.page_no < pageStart || img.page_no > pageEnd);
  const secPageStart = pageStart + Math.floor((idx / total) * totalPages);
  const secPageEnd = pageStart + Math.floor(((idx + 1) / total) * totalPages) - 1;
  const fromPages = located.filter((img) => img.page_no >= secPageStart && img.page_no <= secPageEnd);
  const fromLegacy = legacy.filter((_, i) => Math.floor((i / legacy.length) * total) === idx);
  return [...fromPages, ...fromLegacy];
}

// ── Tick ───────────────────────────────────────────────────────────────────────

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

// ── Reading time ───────────────────────────────────────────────────────────────

function estimateMins(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

// ── Chat panel ─────────────────────────────────────────────────────────────────

function ChatPanel({
  sessionId,
  focusedSection,
}: {
  sessionId: number | null;
  focusedSection: FocusSection | null;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages = [] } = useQuery<ChatMessage[]>({
    queryKey: ["chat-messages", sessionId],
    queryFn: () => (sessionId ? getChatMessages(sessionId) : Promise.resolve([])),
    enabled: !!sessionId,
    refetchInterval: false,
  });

  const deleteMsg = useMutation({
    mutationFn: (id: number) => deleteChatMessage(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat-messages", sessionId] }),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSend() {
    if (!draft.trim() || !sessionId || sending) return;
    const text = draft.trim();
    setDraft("");
    setSending(true);
    try {
      await sendChatMessage(sessionId, text, focusedSection?.id);
      qc.invalidateQueries({ queryKey: ["chat-messages", sessionId] });
    } finally {
      setSending(false);
    }
  }

  if (!sessionId) {
    return (
      <div style={{ padding: "1rem", color: "var(--text3)", fontSize: 13 }}>
        Session not yet saved — keep studying and chat will enable shortly.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Section context badge */}
      {focusedSection && (
        <div style={{
          padding: "5px 10px", fontSize: 10, color: "var(--accent)",
          background: "rgba(99,102,241,0.07)", borderBottom: "1px solid var(--border)",
          lineHeight: 1.4,
        }}>
          Context: {focusedSection.title}
        </div>
      )}

      {/* Message list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem 0.75rem 0" }}>
        {messages.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--text3)", textAlign: "center", marginTop: 20 }}>
            Ask anything about the material.
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              marginBottom: 10,
              display: "flex",
              flexDirection: "column",
              alignItems: msg.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div style={{
              maxWidth: "88%", padding: "7px 10px", fontSize: 12, lineHeight: 1.55,
              borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
              background: msg.role === "user" ? "var(--accent)" : "var(--bg2)",
              color: msg.role === "user" ? "white" : "var(--text)",
              border: msg.role === "assistant" ? "1px solid var(--border)" : "none",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}>
              {msg.content}
            </div>
            <button
              onClick={() => deleteMsg.mutate(msg.id)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 9, color: "var(--text3)", padding: "2px 4px", marginTop: 1,
              }}
            >✕</button>
          </div>
        ))}
        {sending && (
          <div style={{ fontSize: 12, color: "var(--text3)", padding: "4px 8px" }}>…</div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "0.5rem 0.75rem", borderTop: "1px solid var(--border)" }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about the material…"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
          }}
          style={{
            width: "100%", background: "var(--bg3)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)", color: "var(--text)", padding: "6px 8px",
            fontSize: 12, fontFamily: "var(--font)", resize: "none",
            boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
          <button
            className="btn"
            style={{ fontSize: 11, padding: "4px 12px" }}
            onClick={handleSend}
            disabled={!draft.trim() || sending}
          >
            {sending ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── External Resource card ─────────────────────────────────────────────────────

function ResourceCard({ resource, onDelete }: { resource: ExternalResource; onDelete: () => void }) {
  return (
    <div style={{
      marginBottom: 10, padding: "10px 12px",
      background: "var(--bg2)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-sm)",
    }}>
      <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 8, fontStyle: "italic" }}>
        "{resource.selected_text.length > 70 ? resource.selected_text.slice(0, 70) + "…" : resource.selected_text}"
      </div>
      {resource.resources.map((r, i) => (
        <div key={i} style={{ marginBottom: 8 }}>
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 13, color: "var(--accent)", textDecoration: "none", fontWeight: 500, display: "block", lineHeight: 1.3 }}
          >
            {r.title}
          </a>
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2, lineHeight: 1.4 }}>{r.snippet}</div>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
        <button
          onClick={onDelete}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "var(--text3)", padding: "1px 4px" }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

// ── Screenshot card ────────────────────────────────────────────────────────────

function ScreenshotCard({
  screenshot,
  onDelete,
  onUpdateCaption,
}: {
  screenshot: SectionScreenshot;
  onDelete: () => void;
  onUpdateCaption: (caption: string) => void;
}) {
  const [editingCaption, setEditingCaption] = useState(false);
  const [captionDraft, setCaptionDraft] = useState(screenshot.caption ?? "");

  useEffect(() => { setCaptionDraft(screenshot.caption ?? ""); }, [screenshot.caption]);

  return (
    <div style={{ display: "flex", flexDirection: "column", maxWidth: 180 }}>
      <div style={{ position: "relative" }}>
        <img
          src={`http://localhost:8000${screenshot.url}`}
          alt={screenshot.caption ?? `Screenshot ${screenshot.seq}`}
          style={{
            width: "100%", maxHeight: 140, objectFit: "contain",
            border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
            background: "var(--bg2)", cursor: "zoom-in", display: "block",
          }}
          onClick={() => window.open(`http://localhost:8000${screenshot.url}`, "_blank")}
        />
        <button
          onClick={onDelete}
          style={{
            position: "absolute", top: 4, right: 4,
            background: "rgba(0,0,0,0.55)", border: "none", borderRadius: "50%",
            color: "white", width: 18, height: 18, cursor: "pointer", fontSize: 10,
            display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
          }}
        >✕</button>
      </div>

      {editingCaption ? (
        <div style={{ display: "flex", gap: 3, marginTop: 4 }}>
          <input
            value={captionDraft}
            onChange={(e) => setCaptionDraft(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") { onUpdateCaption(captionDraft); setEditingCaption(false); }
              if (e.key === "Escape") { setCaptionDraft(screenshot.caption ?? ""); setEditingCaption(false); }
            }}
            style={{
              flex: 1, fontSize: 10, background: "var(--bg3)", border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)", color: "var(--text)", padding: "2px 5px",
            }}
          />
          <button
            className="btn"
            style={{ fontSize: 10, padding: "2px 6px" }}
            onClick={() => { onUpdateCaption(captionDraft); setEditingCaption(false); }}
          >✓</button>
        </div>
      ) : (
        <div
          onClick={() => setEditingCaption(true)}
          style={{
            fontSize: 10, color: screenshot.caption ? "var(--text3)" : "var(--border2)",
            marginTop: 4, cursor: "text", minHeight: 14, lineHeight: 1.3,
          }}
        >
          {screenshot.caption || "Add caption…"}
        </div>
      )}
    </div>
  );
}

// ── Screenshot upload button ───────────────────────────────────────────────────

function ScreenshotUpload({ onUpload }: { onUpload: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) { onUpload(file); e.target.value = ""; }
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        style={{
          marginTop: 8, fontSize: 11, color: "var(--text3)",
          background: "none", border: "1px dashed var(--border)",
          borderRadius: "var(--radius-sm)", padding: "4px 12px",
          cursor: "pointer",
        }}
      >
        + Screenshot
      </button>
    </>
  );
}

// ── Note editor ────────────────────────────────────────────────────────────────

function NoteItem({
  note,
  onUpdate,
  onDelete,
}: {
  note: SectionNote;
  onUpdate: (id: number, body: string) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);

  return (
    <div style={{
      background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.2)",
      borderRadius: "var(--radius-sm)", padding: "8px 10px", marginBottom: 6,
    }}>
      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            style={{
              width: "100%", minHeight: 64, background: "var(--bg3)",
              border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
              color: "var(--text)", padding: "6px 8px", fontSize: 13,
              fontFamily: "var(--font)", resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
            <button
              className="btn btn--ghost" style={{ fontSize: 11, padding: "3px 8px" }}
              onClick={() => { setDraft(note.body); setEditing(false); }}
            >Cancel</button>
            <button
              className="btn" style={{ fontSize: 11, padding: "3px 8px" }}
              onClick={() => { onUpdate(note.id, draft); setEditing(false); }}
              disabled={!draft.trim()}
            >Save</button>
          </div>
        </>
      ) : (
        <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
          <p style={{ flex: 1, margin: 0, fontSize: 13, color: "var(--text)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
            {note.body}
          </p>
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            <button
              onClick={() => setEditing(true)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--text3)", padding: "2px 4px" }}
            >Edit</button>
            <button
              onClick={() => onDelete(note.id)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--red)", padding: "2px 4px" }}
            >✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Notes panel ────────────────────────────────────────────────────────────────

function NotesPanel({
  section,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
}: {
  section: FocusSection | null;
  onAddNote: (sectionId: number, body: string) => void;
  onUpdateNote: (noteId: number, body: string) => void;
  onDeleteNote: (noteId: number) => void;
}) {
  const [draft, setDraft] = useState("");

  useEffect(() => { setDraft(""); }, [section?.id]);

  if (!section) {
    return (
      <div style={{ padding: "1rem", color: "var(--text3)", fontSize: 13 }}>
        Click a section heading to view notes here.
      </div>
    );
  }

  return (
    <div style={{ padding: "0.75rem 1rem", overflowY: "auto", height: "100%" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 10 }}>
        {section.title}
      </div>

      {section.notes.length === 0 && !draft && (
        <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>No notes yet.</div>
      )}

      {section.notes.map((note) => (
        <NoteItem
          key={note.id}
          note={note}
          onUpdate={onUpdateNote}
          onDelete={onDeleteNote}
        />
      ))}

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Add a note..."
        style={{
          width: "100%", minHeight: 72, background: "var(--bg3)",
          border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
          color: "var(--text)", padding: "6px 8px", fontSize: 13,
          fontFamily: "var(--font)", resize: "vertical", marginTop: 4,
        }}
      />
      {draft.trim() && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
          <button
            className="btn" style={{ fontSize: 12, padding: "4px 12px" }}
            onClick={() => { onAddNote(section.id, draft); setDraft(""); }}
          >
            Add Note
          </button>
        </div>
      )}
    </div>
  );
}

// ── Section row ────────────────────────────────────────────────────────────────

function FocusSectionRow({
  section,
  images,
  isFocused,
  onFocus,
  onToggleComplete,
  onDeleteResource,
  onAddScreenshot,
  onDeleteScreenshot,
  onUpdateCaption,
}: {
  section: FocusSection;
  images: CanvasImage[];
  isFocused: boolean;
  onFocus: () => void;
  onToggleComplete: () => void;
  onDeleteResource: (resourceId: number) => void;
  onAddScreenshot: (sectionId: number, file: File) => void;
  onDeleteScreenshot: (screenshotId: number) => void;
  onUpdateCaption: (screenshotId: number, caption: string) => void;
}) {
  const isMain = section.level <= 1;
  const isSub = section.level === 2;
  const hasNotes = section.notes.length > 0;

  return (
    <div
      id={`section-${section.id}`}
      style={{
        marginBottom: isMain ? 24 : 12,
        paddingLeft: isSub ? 18 : 0,
        borderLeft: isSub ? "2px solid var(--border)" : "none",
        opacity: section.is_completed ? 0.5 : 1,
        transition: "opacity 0.2s",
      }}
    >
      <div
        onClick={onFocus}
        style={{
          display: "flex", alignItems: "center", gap: 8, marginBottom: 6,
          cursor: "pointer", padding: "4px 6px 4px 0",
          borderRadius: "var(--radius-sm)",
          background: isFocused ? "rgba(99,102,241,0.08)" : "transparent",
          transition: "background 0.15s",
        }}
      >
        {isMain && (
          <Tick done={section.is_completed} onToggle={onToggleComplete} size={15} />
        )}
        <span style={{
          flex: 1,
          fontSize: isMain ? 15 : 13,
          fontWeight: isMain ? 700 : 600,
          color: isMain ? "var(--text)" : "var(--accent)",
          textDecoration: section.is_completed ? "line-through" : "none",
        }}>
          {section.title}
        </span>
        {section.body && (
          <span style={{ fontSize: 9, color: "var(--text3)", flexShrink: 0 }}>
            ~{estimateMins(section.body)}m
          </span>
        )}
        {hasNotes && (
          <span style={{
            fontSize: 10, color: "var(--amber)", fontWeight: 600,
            background: "rgba(245,158,11,0.12)", padding: "1px 5px", borderRadius: 99,
          }}>
            {section.notes.length} note{section.notes.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div data-section-id={section.id} style={{ paddingLeft: isMain ? 23 : 0 }}>
        <MarkdownBody md={section.body} />
        <ImageStrip images={images} />

        {/* External resources */}
        {section.resources.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{
              fontSize: 10, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: "0.08em", color: "var(--text3)", marginBottom: 6,
            }}>
              External Resources
            </div>
            {section.resources.map((res) => (
              <ResourceCard key={res.id} resource={res} onDelete={() => onDeleteResource(res.id)} />
            ))}
          </div>
        )}

        {/* Screenshots */}
        {section.screenshots.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
            {section.screenshots.map((sc) => (
              <ScreenshotCard
                key={sc.id}
                screenshot={sc}
                onDelete={() => onDeleteScreenshot(sc.id)}
                onUpdateCaption={(cap) => onUpdateCaption(sc.id, cap)}
              />
            ))}
          </div>
        )}

        <ScreenshotUpload onUpload={(file) => onAddScreenshot(section.id, file)} />
      </div>
    </div>
  );
}

// ── Timer bar ──────────────────────────────────────────────────────────────────

function TimerBar({
  budgetMinutes,
  elapsedSeconds,
  running,
  onToggle,
  onSetBudget,
}: {
  budgetMinutes: number;
  elapsedSeconds: number;
  running: boolean;
  onToggle: () => void;
  onSetBudget: (m: number) => void;
}) {
  const budgetSecs = budgetMinutes * 60;
  const pct = Math.min(100, Math.round((elapsedSeconds / budgetSecs) * 100));
  const remaining = Math.max(0, budgetSecs - elapsedSeconds);
  const over = elapsedSeconds > budgetSecs;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: over ? "var(--red)" : "var(--text)", fontWeight: 600, minWidth: 56 }}>
        {fmtTime(elapsedSeconds)}
      </div>

      <div style={{ flex: 1, height: 4, background: "var(--bg3)", borderRadius: 99, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`,
          background: over ? "var(--red)" : pct > 80 ? "var(--amber)" : "var(--green)",
          borderRadius: 99, transition: "width 1s linear",
        }} />
      </div>

      <div style={{ fontSize: 11, color: "var(--text3)", minWidth: 60, textAlign: "right" }}>
        {over ? `+${fmtTime(elapsedSeconds - budgetSecs)}` : `${fmtTime(remaining)} left`}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type="number"
          value={budgetMinutes}
          min={5} max={480}
          onChange={(e) => onSetBudget(Number(e.target.value))}
          style={{
            width: 46, background: "var(--bg3)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)", color: "var(--text)", fontSize: 12,
            padding: "2px 6px", textAlign: "center",
          }}
        />
        <span style={{ fontSize: 11, color: "var(--text3)" }}>min</span>
      </div>

      <button
        onClick={onToggle}
        style={{
          background: running ? "var(--bg3)" : "var(--accent)",
          border: "none", borderRadius: "var(--radius-sm)",
          color: running ? "var(--text2)" : "white",
          padding: "4px 10px", fontSize: 12, cursor: "pointer", fontWeight: 600,
        }}
      >
        {running ? "⏸" : "▶"}
      </button>
    </div>
  );
}

// ── Session Picker ─────────────────────────────────────────────────────────────

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function SessionPicker({
  courseCode,
  initialChunkIds,
  onResume,
  onStartFresh,
}: {
  courseCode: string;
  initialChunkIds: number[];
  onResume: (session: FocusSession) => void;
  onStartFresh: () => void;
}) {
  const { data: sessions = [], isLoading } = useQuery<FocusSession[]>({
    queryKey: ["focus-sessions-picker", courseCode],
    queryFn: () => listFocusSessions(courseCode),
  });

  // Skip picker if no prior sessions
  useEffect(() => {
    if (!isLoading && sessions.length === 0) onStartFresh();
  }, [isLoading, sessions.length]);

  if (isLoading || sessions.length === 0) {
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ color: "var(--text3)", fontSize: 13 }}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "var(--bg)", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: "2rem",
    }}>
      <div style={{ maxWidth: 480, width: "100%" }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 4px", color: "var(--text)" }}>
          Resume a session?
        </h2>
        <p style={{ fontSize: 13, color: "var(--text3)", margin: "0 0 20px" }}>
          You have previous {courseCode} sessions. Pick one to continue or start fresh.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          {sessions.slice(0, 5).map((s) => {
            const elapsed = s.elapsed_seconds;
            const pctDone = s.budget_minutes > 0
              ? Math.min(100, Math.round((elapsed / (s.budget_minutes * 60)) * 100))
              : 0;
            return (
              <button
                key={s.id}
                onClick={() => onResume(s)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  background: "var(--bg2)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius)", padding: "12px 14px",
                  cursor: "pointer", textAlign: "left", width: "100%",
                  transition: "border-color 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>
                    {s.label ?? `${s.chunk_ids.length} lecture${s.chunk_ids.length > 1 ? "s" : ""}`}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text3)" }}>
                    {relativeDate(s.updated_at)} · {fmtTime(elapsed)} elapsed · {s.budget_minutes}m budget
                  </div>
                  {/* Mini progress bar */}
                  <div style={{ height: 2, background: "var(--bg3)", borderRadius: 99, overflow: "hidden", marginTop: 6 }}>
                    <div style={{
                      height: "100%", width: `${pctDone}%`,
                      background: pctDone >= 100 ? "var(--red)" : pctDone > 80 ? "var(--amber)" : "var(--accent)",
                      borderRadius: 99,
                    }} />
                  </div>
                </div>
                <span style={{ fontSize: 12, color: "var(--accent)", flexShrink: 0 }}>Resume →</span>
              </button>
            );
          })}
        </div>

        <button
          className="btn"
          style={{ width: "100%", fontSize: 13, padding: "10px 0" }}
          onClick={onStartFresh}
        >
          Start fresh with {initialChunkIds.length} lecture{initialChunkIds.length > 1 ? "s" : ""}
        </button>
      </div>
    </div>
  );
}

// ── Main FocusMode component ───────────────────────────────────────────────────

export function FocusMode({
  courseCode,
  initialChunkIds,
  existingSession,
  onExit,
}: {
  courseCode: string;
  initialChunkIds: number[];
  existingSession: FocusSession | null;
  onExit: () => void;
}) {
  const qc = useQueryClient();

  // Phase: pick = session picker, study = canvas
  const [phase, setPhase] = useState<"pick" | "study">(existingSession ? "study" : "pick");
  const [effectiveChunkIds, setEffectiveChunkIds] = useState<number[]>(
    existingSession ? (existingSession.chunk_ids.length > 0 ? existingSession.chunk_ids : initialChunkIds) : initialChunkIds
  );

  // Session state
  const [sessionId, setSessionId] = useState<number | null>(existingSession?.id ?? null);
  const [budgetMinutes, setBudgetMinutes] = useState(existingSession?.budget_minutes ?? 60);
  const [elapsedSeconds, setElapsedSeconds] = useState(existingSession?.elapsed_seconds ?? 0);
  const [timerRunning, setTimerRunning] = useState(true);
  const [focusedSection, setFocusedSection] = useState<FocusSection | null>(null);
  const [activeChunkId, setActiveChunkId] = useState<number | null>(existingSession?.last_chunk_id ?? initialChunkIds[0] ?? null);

  const [rightTab, setRightTab] = useState<"notes" | "chat">("notes");

  // Selection popover
  const [selectionPopover, setSelectionPopover] = useState<{
    text: string; sectionId: number; x: number; y: number;
  } | null>(null);
  const [popoverInstructions, setPopoverInstructions] = useState("");
  const [popoverSearching, setPopoverSearching] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Dismiss popover on outside click
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setSelectionPopover(null);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  // Timer
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (timerRunning) {
      timerRef.current = setInterval(() => setElapsedSeconds((e) => e + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning]);

  // Persist session every 15s
  const saveSession = useCallback(async () => {
    const payload = {
      elapsed_seconds: elapsedSeconds,
      last_chunk_id: activeChunkId ?? undefined,
      budget_minutes: budgetMinutes,
    };
    if (sessionId) {
      await updateFocusSession(sessionId, payload);
    } else {
      const s = await createFocusSession({
        course_code: courseCode,
        chunk_ids: effectiveChunkIds,
        budget_minutes: budgetMinutes,
      });
      setSessionId(s.id);
    }
  }, [sessionId, elapsedSeconds, activeChunkId, budgetMinutes, courseCode, initialChunkIds]);

  useEffect(() => {
    const interval = setInterval(saveSession, 15_000);
    return () => clearInterval(interval);
  }, [saveSession]);

  useEffect(() => { return () => { saveSession(); }; }, [saveSession]);

  // Fetch chunks
  const { data: chunks = [], isLoading } = useQuery<FocusChunk[]>({
    queryKey: ["focus-chunks", effectiveChunkIds.join(",")],
    queryFn: () => fetchFocusChunks(effectiveChunkIds),
    enabled: phase === "study",
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["focus-chunks", effectiveChunkIds.join(",")] });

  // Note mutations
  const addNoteMutation = useMutation({
    mutationFn: ({ sectionId, body }: { sectionId: number; body: string }) => addNote(sectionId, body),
    onSuccess: invalidate,
  });

  const updateNoteMutation = useMutation({
    mutationFn: ({ noteId, body }: { noteId: number; body: string }) => updateNote(noteId, body),
    onSuccess: invalidate,
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (noteId: number) => deleteNote(noteId),
    onSuccess: invalidate,
  });

  const sectionCompleteMutation = useMutation({
    mutationFn: ({ id, done }: { id: number; done: boolean }) => setSectionCompletion(id, done),
    onSuccess: invalidate,
  });

  const chunkCompleteMutation = useMutation({
    mutationFn: ({ id, done }: { id: number; done: boolean }) => setChunkCompletion(id, done),
    onSuccess: invalidate,
  });

  // Resource mutations
  const deleteResourceMutation = useMutation({
    mutationFn: (resourceId: number) => deleteResource(resourceId),
    onSuccess: invalidate,
  });

  // Screenshot mutations
  const uploadScreenshotMutation = useMutation({
    mutationFn: ({ sectionId, file }: { sectionId: number; file: File }) => uploadScreenshot(sectionId, file),
    onSuccess: invalidate,
  });

  const deleteScreenshotMutation = useMutation({
    mutationFn: (screenshotId: number) => deleteScreenshot(screenshotId),
    onSuccess: invalidate,
  });

  const updateCaptionMutation = useMutation({
    mutationFn: ({ id, caption }: { id: number; caption: string }) => updateScreenshotCaption(id, caption),
    onSuccess: invalidate,
  });

  // Text selection → popover
  function handleContentMouseUp() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
    const text = sel.toString().trim();
    if (text.length < 5) return;

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Walk up DOM to find data-section-id
    let node: Node | null = range.commonAncestorContainer;
    while (node) {
      if (node instanceof HTMLElement && node.dataset.sectionId) {
        setSelectionPopover({
          text,
          sectionId: parseInt(node.dataset.sectionId),
          x: rect.left + rect.width / 2,
          y: rect.bottom + 8,
        });
        setPopoverInstructions("");
        return;
      }
      node = node.parentNode;
    }
  }

  // Compute progress
  const allSections = chunks.flatMap((c) => c.sections.filter((s) => s.level <= 1));
  const doneSections = allSections.filter((s) => s.is_completed).length;
  const progressPct = allSections.length > 0 ? Math.round((doneSections / allSections.length) * 100) : 0;

  // Session picker
  if (phase === "pick") {
    return (
      <SessionPicker
        courseCode={courseCode}
        initialChunkIds={initialChunkIds}
        onResume={(session) => {
          const ids = session.chunk_ids.length > 0 ? session.chunk_ids : initialChunkIds;
          setEffectiveChunkIds(ids);
          setSessionId(session.id);
          setBudgetMinutes(session.budget_minutes);
          setElapsedSeconds(session.elapsed_seconds);
          setActiveChunkId(session.last_chunk_id ?? ids[0] ?? null);
          setPhase("study");
        }}
        onStartFresh={() => {
          setEffectiveChunkIds(initialChunkIds);
          setPhase("study");
        }}
      />
    );
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "var(--bg)", display: "flex", flexDirection: "column",
    }}>
      {/* Top bar */}
      <div style={{
        height: 52, borderBottom: "1px solid var(--border)", flexShrink: 0,
        display: "flex", alignItems: "center", padding: "0 1.5rem", gap: 16,
      }}>
        <button
          onClick={() => { saveSession(); onExit(); }}
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 12, color: "var(--text3)", padding: "4px 0",
            display: "flex", alignItems: "center", gap: 4,
          }}
        >
          ← Exit Focus
        </button>

        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", flex: "0 0 auto" }}>
          {courseCode}
          {chunks.length > 1 && (
            <span style={{ fontWeight: 400, color: "var(--text3)", marginLeft: 6 }}>
              · {chunks.length} lectures
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
          <div style={{ width: 80, height: 4, background: "var(--bg3)", borderRadius: 99, overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${progressPct}%`,
              background: progressPct === 100 ? "var(--green)" : "var(--accent)",
              borderRadius: 99, transition: "width 0.3s",
            }} />
          </div>
          <span style={{ fontSize: 11, color: "var(--text3)" }}>
            {doneSections}/{allSections.length}
          </span>
        </div>

        <div style={{ flex: 1, maxWidth: 400, marginLeft: "auto" }}>
          <TimerBar
            budgetMinutes={budgetMinutes}
            elapsedSeconds={elapsedSeconds}
            running={timerRunning}
            onToggle={() => setTimerRunning((r) => !r)}
            onSetBudget={setBudgetMinutes}
          />
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Left: lecture list */}
        <div style={{
          width: 220, minWidth: 220, borderRight: "1px solid var(--border)",
          overflowY: "auto", padding: "0.75rem 0",
        }}>
          {chunks.map((c) => {
            const mainSecs = c.sections.filter((s) => s.level <= 1);
            const done = mainSecs.filter((s) => s.is_completed).length;
            const pct = mainSecs.length > 0 ? Math.round((done / mainSecs.length) * 100) : 0;
            const active = activeChunkId === c.id;
            const totalMins = c.sections.reduce((sum, s) => sum + (s.body ? estimateMins(s.body) : 0), 0);
            return (
              <div key={c.id} style={{
                display: "flex", alignItems: "stretch",
                borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
                background: active ? "var(--bg3)" : "transparent",
              }}>
                <div style={{ display: "flex", alignItems: "center", paddingLeft: 8 }}>
                  <Tick done={c.is_completed} onToggle={() => chunkCompleteMutation.mutate({ id: c.id, done: !c.is_completed })} size={13} />
                </div>
                <button
                  onClick={() => {
                    setActiveChunkId(c.id);
                    document.getElementById(`chunk-${c.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  style={{
                    flex: 1, textAlign: "left", background: "none", border: "none",
                    padding: "0.6rem 0.75rem 0.6rem 7px", cursor: "pointer",
                    color: c.is_completed ? "var(--text3)" : "var(--text)",
                    textDecoration: c.is_completed ? "line-through" : "none",
                    fontSize: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 4 }}>
                    <span style={{ fontWeight: active ? 600 : 400, flex: 1, lineHeight: 1.3 }}>{c.title}</span>
                    {totalMins > 0 && (
                      <span style={{ fontSize: 9, color: "var(--text3)", flexShrink: 0 }}>~{totalMins}m</span>
                    )}
                  </div>
                  <div style={{ height: 2, background: "var(--bg3)", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", width: `${pct}%`,
                      background: pct === 100 ? "var(--green)" : "var(--accent)",
                      borderRadius: 99,
                    }} />
                  </div>
                </button>
              </div>
            );
          })}
        </div>

        {/* Center: content */}
        <div
          style={{ flex: 1, overflowY: "auto", padding: "1.5rem 2rem" }}
          onMouseUp={handleContentMouseUp}
        >
          {isLoading && <div style={{ color: "var(--text3)", fontSize: 13 }}>Loading...</div>}
          {chunks.map((chunk) => (
            <div key={chunk.id} id={`chunk-${chunk.id}`} style={{ marginBottom: 40 }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                marginBottom: 20, paddingBottom: 12,
                borderBottom: "2px solid var(--border)",
              }}>
                <Tick
                  done={chunk.is_completed}
                  onToggle={() => chunkCompleteMutation.mutate({ id: chunk.id, done: !chunk.is_completed })}
                  size={20}
                />
                <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: "var(--text)" }}>
                  {chunk.title}
                </h2>
                <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: "auto" }}>
                  Pages {chunk.page_start + 1}–{chunk.page_end + 1}
                </span>
              </div>

              {chunk.sections.map((section, idx) => (
                <FocusSectionRow
                  key={section.section_key}
                  section={section}
                  images={getImagesForSection(idx, chunk.sections.length, chunk.images, chunk.page_start, chunk.page_end)}
                  isFocused={focusedSection?.id === section.id}
                  onFocus={() => setFocusedSection(section)}
                  onToggleComplete={() => sectionCompleteMutation.mutate({ id: section.id, done: !section.is_completed })}
                  onDeleteResource={(resourceId) => deleteResourceMutation.mutate(resourceId)}
                  onAddScreenshot={(sectionId, file) => uploadScreenshotMutation.mutate({ sectionId, file })}
                  onDeleteScreenshot={(screenshotId) => deleteScreenshotMutation.mutate(screenshotId)}
                  onUpdateCaption={(screenshotId, caption) => updateCaptionMutation.mutate({ id: screenshotId, caption })}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Right: notes / chat panel */}
        <div style={{
          width: 280, minWidth: 280, borderLeft: "1px solid var(--border)",
          display: "flex", flexDirection: "column",
        }}>
          {/* Tab header */}
          <div style={{
            display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0,
          }}>
            {(["notes", "chat"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setRightTab(tab)}
                style={{
                  flex: 1, border: "none", background: "none", cursor: "pointer",
                  padding: "8px 0", fontSize: 11, fontWeight: 700,
                  letterSpacing: "0.07em", textTransform: "uppercase",
                  color: rightTab === tab ? "var(--accent)" : "var(--text3)",
                  borderBottom: rightTab === tab ? "2px solid var(--accent)" : "2px solid transparent",
                  transition: "color 0.15s",
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflow: "hidden" }}>
            {rightTab === "notes" ? (
              <NotesPanel
                section={focusedSection}
                onAddNote={(sectionId, body) => addNoteMutation.mutate({ sectionId, body })}
                onUpdateNote={(noteId, body) => updateNoteMutation.mutate({ noteId, body })}
                onDeleteNote={(noteId) => deleteNoteMutation.mutate(noteId)}
              />
            ) : (
              <ChatPanel
                sessionId={sessionId}
                focusedSection={focusedSection}
              />
            )}
          </div>
        </div>
      </div>

      {/* Selection popover */}
      {selectionPopover && (
        <div
          ref={popoverRef}
          style={{
            position: "fixed",
            left: selectionPopover.x,
            top: selectionPopover.y,
            transform: "translateX(-50%)",
            background: "var(--bg2)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "10px 12px",
            zIndex: 2000,
            minWidth: 260,
            boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
          }}
        >
          <div style={{
            fontSize: 11, color: "var(--text3)", marginBottom: 8,
            fontStyle: "italic", lineHeight: 1.4,
          }}>
            "{selectionPopover.text.length > 80 ? selectionPopover.text.slice(0, 80) + "…" : selectionPopover.text}"
          </div>
          <input
            placeholder="Optional guidance (e.g. 'focus on Python examples')"
            value={popoverInstructions}
            onChange={(e) => setPopoverInstructions(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setSelectionPopover(null)}
            autoFocus
            style={{
              width: "100%", background: "var(--bg3)", border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)", color: "var(--text)", padding: "5px 8px",
              fontSize: 12, marginBottom: 8, boxSizing: "border-box",
            }}
          />
          <button
            className="btn"
            style={{ width: "100%", fontSize: 12 }}
            disabled={popoverSearching}
            onClick={async () => {
              setPopoverSearching(true);
              try {
                await generateResources(selectionPopover.sectionId, selectionPopover.text, popoverInstructions);
                invalidate();
                setSelectionPopover(null);
              } finally {
                setPopoverSearching(false);
              }
            }}
          >
            {popoverSearching ? "Searching…" : "Find External Resources"}
          </button>
        </div>
      )}

      <style>{`
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
