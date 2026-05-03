import { useState } from "react";
import { parseISO } from "date-fns";
import { Item, Course } from "../api/client";

const API = "http://localhost:8000";

interface Props {
  item: Item;
  course: Course | null;
  onBack: () => void;
}

function formatDue(dueAt: string | null) {
  if (!dueAt) return "—";
  return parseISO(dueAt).toLocaleDateString("en-PK", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function timeUntil(dueAt: string | null) {
  if (!dueAt) return { label: "No deadline", urgent: false, overdue: false };
  const diff = parseISO(dueAt).getTime() - Date.now();
  if (diff < 0) return { label: "Overdue", urgent: true, overdue: true };
  const h = Math.floor(diff / 3_600_000);
  const d = Math.floor(h / 24);
  if (h === 0) { const m = Math.floor(diff / 60000); return { label: `${m}m left`, urgent: true, overdue: false }; }
  if (d === 0) return { label: `${h}h left`, urgent: h < 6, overdue: false };
  if (d === 1) return { label: `${d}d ${h % 24}h left`, urgent: true, overdue: false };
  return { label: `${d}d left`, urgent: false, overdue: false };
}

function Spinner() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="spin">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" strokeDasharray="16 10" />
    </svg>
  );
}

function InlineFileViewer({ itemId, title }: { itemId: number; title: string }) {
  const [loading, setLoading] = useState(true);
  return (
    <div className="file-viewer" style={{ marginTop: "1rem" }}>
      <div className="file-viewer__header">
        <div className="file-viewer__title">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 1.5h5l3 3v7.5a.75.75 0 01-.75.75H3a.75.75 0 01-.75-.75V2.25A.75.75 0 013 1.5z" stroke="currentColor" strokeWidth="1.3" />
          </svg>
          {title}
        </div>
        <a href={`${API}/api/items/${itemId}/file`} download className="fv-modal__dl">↓ Download</a>
      </div>
      <div style={{ flex: 1, position: "relative", minHeight: 400 }}>
        {loading && (
          <div className="fv-modal__loading" style={{ position: "absolute", inset: 0, zIndex: 1 }}>
            <div className="fv-modal__spinner" />
            Fetching file from LMS…
            <span className="fv-modal__hint">First load launches a browser — takes ~20 seconds</span>
          </div>
        )}
        <iframe
          src={`${API}/api/items/${itemId}/file/view`}
          style={{ width: "100%", minHeight: 400, border: "none", display: "block" }}
          onLoad={() => setLoading(false)}
        />
      </div>
    </div>
  );
}

export function AssignmentDetail({ item, course, onBack }: Props) {
  const [viewingFile, setViewingFile] = useState(false);
  const [question, setQuestion] = useState("");
  const [solution, setSolution] = useState("");

  // AI state
  const [hintLoading, setHintLoading] = useState(false);
  const [hint, setHint] = useState("");
  const [completeLoading, setCompleteLoading] = useState(false);
  const [completeDone, setCompleteDone] = useState(false);

  // Format for upload state
  const [formatLoading, setFormatLoading] = useState(false);
  const [generatedFile, setGeneratedFile] = useState<{ filename: string; file_url: string } | null>(null);

  // Submit state
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ status: string; message: string } | null>(null);
  const [submitted, setSubmitted] = useState(
    item.status === "Submitted" || Boolean(item.completed_at)
  );

  const wordCount = solution.trim() ? solution.trim().split(/\s+/).length : 0;
  const time = timeUntil(item.due_at);
  const hasFile = Boolean(item.file_url);
  const busy = hintLoading || completeLoading || formatLoading || submitLoading;

  async function handleGetHint() {
    if (!question.trim() && !solution.trim()) return;
    setHintLoading(true);
    setHint("");
    try {
      const res = await fetch(`${API}/api/assignments/${item.id}/hint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, solution_so_far: solution }),
      });
      const data = await res.json();
      setHint(data.hint ?? "Could not reach AI.");
    } catch {
      setHint("Could not reach AI. Please try again.");
    }
    setHintLoading(false);
  }

  async function handleAiComplete() {
    if (!question.trim()) return;
    setCompleteLoading(true);
    setCompleteDone(false);
    try {
      const res = await fetch(`${API}/api/assignments/${item.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      setSolution(data.solution ?? solution);
      setCompleteDone(true);
    } catch {
      // leave solution unchanged
    }
    setCompleteLoading(false);
  }

  async function handleFormat() {
    if (!solution.trim() || !question.trim()) return;
    setFormatLoading(true);
    setGeneratedFile(null);
    setSubmitResult(null);
    try {
      const res = await fetch(`${API}/api/assignments/${item.id}/format`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, solution }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Format failed");
      }
      const data = await res.json();
      setGeneratedFile(data);
    } catch (e: any) {
      setGeneratedFile(null);
      alert(`Format failed: ${e.message}`);
    }
    setFormatLoading(false);
  }

  async function handleSubmit() {
    if (!generatedFile) return;
    setSubmitLoading(true);
    setSubmitResult(null);
    try {
      const res = await fetch(`${API}/api/assignments/${item.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: generatedFile.filename }),
      });
      const data = await res.json();
      setSubmitResult(data);
      if (data.status === "success") setSubmitted(true);
    } catch {
      setSubmitResult({ status: "error", message: "Could not connect to backend." });
    }
    setSubmitLoading(false);
  }

  // ── Submitted view ─────────────────────────────────────────────────────────
  if (submitted && !submitResult) {
    return (
      <div className="page detail-page">
        <div className="page__header">
          <button className="btn-back" onClick={onBack}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>
          <h1 className="page__title" style={{ marginTop: "0.75rem" }}>{item.title}</h1>
        </div>
        <div className="detail-meta">
          <div className="detail-meta__item"><span className="detail-meta__label">Course</span><span className="detail-meta__value">{item.course_code}</span></div>
          <div className="detail-meta__item"><span className="detail-meta__label">Due Date</span><span className="detail-meta__value">{formatDue(item.due_at)}</span></div>
          {item.total_marks && <div className="detail-meta__item"><span className="detail-meta__label">Total Marks</span><span className="detail-meta__value">{item.total_marks}</span></div>}
          <div className="detail-meta__item"><span className="detail-meta__label">Status</span><span className="status-chip status-chip--submitted">✓ Submitted</span></div>
        </div>
        <div className="detail-body">
          <section className="detail-section">
            <div className="submission-success">
              <div className="submission-success__icon">✓</div>
              <div>
                <div className="submission-success__title">Assignment Submitted</div>
                <div className="submission-success__sub">Verified on LMS</div>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  // ── Main view ──────────────────────────────────────────────────────────────
  return (
    <div className="page detail-page">
      <div className="page__header">
        <button className="btn-back" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.75rem" }}>
          <span className="course-detail__code" style={{ background: "oklch(0.62 0.2 265 / 0.15)", color: "var(--accent)", border: "1px solid oklch(0.62 0.2 265 / 0.3)" }}>
            {item.course_code}
          </span>
          <span className="badge badge--assign">ASSIGN</span>
        </div>
        <h1 className="page__title" style={{ marginTop: "0.5rem" }}>{item.title}</h1>
      </div>

      <div className="detail-meta">
        <div className="detail-meta__item"><span className="detail-meta__label">Due Date</span><span className="detail-meta__value">{formatDue(item.due_at)}</span></div>
        {item.total_marks && <div className="detail-meta__item"><span className="detail-meta__label">Total Marks</span><span className="detail-meta__value">{item.total_marks}</span></div>}
        <div className="detail-meta__item">
          <span className="detail-meta__label">Status</span>
          <span className={`status-chip ${item.status === "Open" ? "status-chip--open" : "status-chip--pending"}`}>{item.status ?? "Pending"}</span>
        </div>
        {!time.overdue && item.due_at && (
          <div className="detail-meta__item">
            <span className="detail-meta__label">Time Left</span>
            <span className={`detail-meta__value ${time.urgent ? "text-urgent" : ""}`}>{time.label}</span>
          </div>
        )}
      </div>

      <div className="detail-body">

        {/* Assignment file */}
        {hasFile && (
          <section className="detail-section">
            <h3 className="detail-section__title">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <path d="M3 2h6l3 3v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.4" />
                <path d="M9 2v3h3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
              Assignment File
            </h3>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button className="btn-file" onClick={() => setViewingFile(v => !v)}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 1.5h5l3 3v7.5a.75.75 0 01-.75.75H3a.75.75 0 01-.75-.75V2.25A.75.75 0 013 1.5z" stroke="currentColor" strokeWidth="1.3" />
                </svg>
                {item.title}
                <span className="btn-file__action">{viewingFile ? "Close" : "View"}</span>
              </button>
              <a href={`${API}/api/items/${item.id}/file`} download className="btn-file">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 1v8M4 6l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M2 11h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                Download
              </a>
            </div>
            {viewingFile && <InlineFileViewer itemId={item.id} title={item.title} />}
          </section>
        )}

        {/* Question context for AI */}
        <section className="detail-section">
          <h3 className="detail-section__title">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path d="M7.5 2a5.5 5.5 0 100 11A5.5 5.5 0 007.5 2zm0 3v2.5m0 2.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            Assignment Question
            <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text3)", marginLeft: "0.5rem" }}>— paste or type for AI context</span>
          </h3>
          <textarea
            className="solution-textarea"
            style={{ minHeight: 80, fontSize: 13 }}
            placeholder="Paste the assignment question here so AI can understand what to solve…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
          />
        </section>

        {/* Solution */}
        <section className="detail-section">
          <div className="solution-header">
            <h3 className="detail-section__title" style={{ marginBottom: 0 }}>
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <path d="M2 12L4.5 13 13 4.5 11.5 3 3 11.5 2 12z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
              Write Your Solution
            </h3>
            <span className="word-count">{wordCount} words</span>
          </div>

          <textarea
            className="solution-textarea"
            placeholder={"Write your solution here.\n\nStart with Question 1, then Q2, Q3…\n\nTip: Use the AI buttons below if you get stuck."}
            value={solution}
            onChange={(e) => setSolution(e.target.value)}
            rows={14}
          />

          {/* Hint response */}
          {hint && (
            <div className="ai-hint-box">
              <div className="ai-hint-box__header">
                <span className="ai-glow-dot" /> AI Hint
              </div>
              <div className="ai-hint-box__body">{hint}</div>
              <button className="btn-dismiss" style={{ marginTop: "0.6rem" }} onClick={() => setHint("")}>Dismiss</button>
            </div>
          )}

          {/* Complete confirmation */}
          {completeDone && (
            <div className="ai-complete-notice">
              <span className="ai-glow-dot" />
              AI has filled in a complete solution above. Review and edit before submitting.
              <button className="btn-dismiss" onClick={() => setCompleteDone(false)}>OK</button>
            </div>
          )}

          {/* Action bar */}
          <div className="solution-ai-bar">
            <div className="solution-ai-bar__left">
              <button
                className="btn-ai-action btn-ai-action--hint"
                onClick={handleGetHint}
                disabled={busy || (!question.trim() && !solution.trim())}
              >
                {hintLoading ? <><Spinner /> Thinking…</> : <><span className="ai-glow-dot" style={{ width: 5, height: 5 }} /> Get a Hint</>}
              </button>
              <button
                className="btn-ai-action btn-ai-action--complete"
                onClick={handleAiComplete}
                disabled={busy || !question.trim()}
              >
                {completeLoading ? <><Spinner /> Writing…</> : "✦ Complete with AI"}
              </button>
            </div>
            <div className="solution-ai-bar__right">
              <button
                className="btn-format"
                onClick={handleFormat}
                disabled={busy || !solution.trim() || !question.trim()}
              >
                {formatLoading ? <><Spinner /> Generating file…</> : <><span className="ai-glow-dot" style={{ width: 5, height: 5 }} /> Format for Upload</>}
              </button>
            </div>
          </div>
        </section>

        {/* Generated file panel */}
        {generatedFile && (
          <section className="detail-section">
            <div className="formatted-panel__header">
              <h3 className="detail-section__title" style={{ marginBottom: 0 }}>
                <span className="ai-glow-dot" /> Generated File — Ready to Submit
              </h3>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "1rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: "var(--text2)" }}>📄 {generatedFile.filename}</span>
              <a
                href={`${API}${generatedFile.file_url}`}
                download={generatedFile.filename}
                className="btn-file"
              >
                ↓ Download to review
              </a>
              <button
                className="btn-submit"
                onClick={handleSubmit}
                disabled={submitLoading}
              >
                {submitLoading ? <><Spinner /> Submitting…</> : "Submit to LMS →"}
              </button>
            </div>

            {submitResult && (
              <div
                style={{
                  marginTop: "0.75rem",
                  padding: "0.75rem 1rem",
                  borderRadius: "var(--radius-sm)",
                  fontSize: 13,
                  background: submitResult.status === "success"
                    ? "oklch(0.55 0.18 145 / 0.15)"
                    : submitResult.status === "error"
                    ? "oklch(0.55 0.2 25 / 0.15)"
                    : "oklch(0.65 0.18 85 / 0.15)",
                  color: submitResult.status === "success"
                    ? "oklch(0.75 0.18 145)"
                    : submitResult.status === "error"
                    ? "oklch(0.75 0.2 25)"
                    : "oklch(0.8 0.18 85)",
                  border: `1px solid ${submitResult.status === "success"
                    ? "oklch(0.55 0.18 145 / 0.3)"
                    : submitResult.status === "error"
                    ? "oklch(0.55 0.2 25 / 0.3)"
                    : "oklch(0.65 0.18 85 / 0.3)"}`,
                }}
              >
                {submitResult.message}
              </div>
            )}
          </section>
        )}

      </div>
    </div>
  );
}
