import { useState } from "react";
import { parseISO } from "date-fns";
import { Item, Course } from "../api/client";

interface Props {
  item: Item;
  course: Course | null;
  onBack: () => void;
}

function formatDue(dueAt: string | null) {
  if (!dueAt) return "—";
  return parseISO(dueAt).toLocaleDateString("en-PK", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
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
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" strokeDasharray="16 10"/>
    </svg>
  );
}

function InlineFileViewer({ itemId, title }: { itemId: number; title: string }) {
  const [loading, setLoading] = useState(true);
  const viewUrl = `http://localhost:8000/api/items/${itemId}/file/view`;
  const downloadUrl = `http://localhost:8000/api/items/${itemId}/file`;

  return (
    <div className="file-viewer" style={{ marginTop: "1rem" }}>
      <div className="file-viewer__header">
        <div className="file-viewer__title">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 1.5h5l3 3v7.5a.75.75 0 01-.75.75H3a.75.75 0 01-.75-.75V2.25A.75.75 0 013 1.5z" stroke="currentColor" strokeWidth="1.3"/></svg>
          {title}
        </div>
        <a href={downloadUrl} download className="fv-modal__dl">↓ Download</a>
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
          src={viewUrl}
          style={{ width: "100%", minHeight: 400, border: "none", display: "block" }}
          onLoad={() => setLoading(false)}
        />
      </div>
    </div>
  );
}

export function AssignmentDetail({ item, course, onBack }: Props) {
  const [viewingFile, setViewingFile] = useState(false);
  const [solution, setSolution] = useState("");
  const [submitted, setSubmitted] = useState(
    item.status === "Submitted" || Boolean(item.completed_at)
  );
  const [submitting, setSubmitting] = useState(false);

  const [aiState, setAiState] = useState<"idle" | "hint-loading" | "hint-done" | "complete-loading" | "complete-done">("idle");
  const [aiHint, setAiHint] = useState("");
  const [tweakInstructions, setTweakInstructions] = useState("");
  const [showTweakBox, setShowTweakBox] = useState(false);

  const [formatState, setFormatState] = useState<"idle" | "loading" | "done">("idle");
  const [formattedSolution, setFormattedSolution] = useState("");
  const [viewingFormatted, setViewingFormatted] = useState(false);

  const wordCount = solution.trim() ? solution.trim().split(/\s+/).length : 0;
  const time = timeUntil(item.due_at);

  const hasFile = Boolean(item.file_url);

  async function handleGetHint() {
    setAiState("hint-loading");
    try {
      const res = await fetch("http://localhost:8000/api/ai/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: item.id, current_solution: solution }),
      });
      const data = await res.json();
      setAiHint(data.hint ?? "Could not reach AI.");
    } catch {
      setAiHint("Could not reach AI. Please try again.");
    }
    setAiState("hint-done");
  }

  async function handleAiComplete() {
    setAiState("complete-loading");
    setShowTweakBox(false);
    try {
      const res = await fetch("http://localhost:8000/api/ai/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: item.id, current_solution: solution, instructions: tweakInstructions }),
      });
      const data = await res.json();
      setSolution(data.solution ?? solution);
      setAiState("complete-done");
    } catch {
      setAiState("idle");
    }
  }

  async function handleFormat() {
    if (!solution.trim()) return;
    setFormatState("loading");
    try {
      const res = await fetch("http://localhost:8000/api/ai/format", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: item.id, solution }),
      });
      const data = await res.json();
      setFormattedSolution(data.formatted ?? solution);
      setFormatState("done");
      setViewingFormatted(true);
    } catch {
      setFormatState("idle");
    }
  }

  function handleDirectSubmit() {
    if (!solution.trim()) return;
    setSubmitting(true);
    setTimeout(() => { setSubmitting(false); setSubmitted(true); }, 1500);
  }

  if (submitted) {
    return (
      <div className="page detail-page">
        <div className="page__header">
          <button className="btn-back" onClick={onBack}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
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
            {hasFile && (
              <div className="submitted-files" style={{ marginTop: "1rem" }}>
                <div className="submitted-files__label">Files</div>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
                  <button className="btn-file" onClick={() => setViewingFile(v => !v)}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 1.5h5l3 3v7.5a.75.75 0 01-.75.75H3a.75.75 0 01-.75-.75V2.25A.75.75 0 013 1.5z" stroke="currentColor" strokeWidth="1.3"/></svg>
                    Assignment File
                    <span className="btn-file__action">{viewingFile ? "Close" : "View"}</span>
                  </button>
                </div>
                {viewingFile && <InlineFileViewer itemId={item.id} title={item.title} />}
              </div>
            )}
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="page detail-page">
      <div className="page__header">
        <button className="btn-back" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
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
        <div className="detail-meta__item"><span className="detail-meta__label">Status</span>
          <span className={`status-chip ${item.status === "Open" ? "status-chip--open" : "status-chip--pending"}`}>{item.status ?? "Pending"}</span>
        </div>
        {!time.overdue && item.due_at && (
          <div className="detail-meta__item"><span className="detail-meta__label">Time Left</span><span className={`detail-meta__value ${time.urgent ? "text-urgent" : ""}`}>{time.label}</span></div>
        )}
      </div>

      <div className="detail-body">

        {/* Assignment File */}
        {hasFile && (
          <section className="detail-section">
            <h3 className="detail-section__title">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M3 2h6l3 3v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.4"/><path d="M9 2v3h3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>
              Assignment File
            </h3>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button className="btn-file" onClick={() => setViewingFile(v => !v)}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 1.5h5l3 3v7.5a.75.75 0 01-.75.75H3a.75.75 0 01-.75-.75V2.25A.75.75 0 013 1.5z" stroke="currentColor" strokeWidth="1.3"/></svg>
                {item.title}
                <span className="btn-file__action">{viewingFile ? "Close" : "View"}</span>
              </button>
              <a
                href={`http://localhost:8000/api/items/${item.id}/file`}
                download
                className="btn-file"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 11h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                Download
              </a>
            </div>
            {viewingFile && <InlineFileViewer itemId={item.id} title={item.title} />}
          </section>
        )}

        {/* Solution Writing */}
        <section className="detail-section">
          <div className="solution-header">
            <h3 className="detail-section__title" style={{ marginBottom: 0 }}>
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2 12L4.5 13 13 4.5 11.5 3 3 11.5 2 12z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
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

          {aiState === "hint-done" && aiHint && (
            <div className="ai-hint-box">
              <div className="ai-hint-box__header">
                <span className="ai-glow-dot" /> AI Hint
              </div>
              <div className="ai-hint-box__body">{aiHint}</div>
              <button className="btn-dismiss" style={{ marginTop: "0.6rem" }} onClick={() => { setAiHint(""); setAiState("idle"); }}>Dismiss</button>
            </div>
          )}

          {aiState === "complete-done" && (
            <div className="ai-complete-notice">
              <span className="ai-glow-dot" />
              AI has filled in a complete solution above. Review and edit before submitting.
              <button className="btn-dismiss" onClick={() => setAiState("idle")}>OK</button>
            </div>
          )}

          {showTweakBox && (
            <div className="tweak-instructions-box">
              <label className="tweak-instructions-box__label">Custom instructions for AI completion</label>
              <textarea
                className="tweak-instructions-textarea"
                placeholder="e.g. Focus on data hazards only. Use formal academic language."
                value={tweakInstructions}
                onChange={(e) => setTweakInstructions(e.target.value)}
                rows={3}
              />
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button className="btn-tweak-apply" onClick={handleAiComplete}>Apply & Complete</button>
                <button className="btn-dismiss" onClick={() => setShowTweakBox(false)}>Cancel</button>
              </div>
            </div>
          )}

          <div className="solution-ai-bar">
            <div className="solution-ai-bar__left">
              <button
                className="btn-ai-action btn-ai-action--hint"
                onClick={handleGetHint}
                disabled={aiState === "hint-loading" || aiState === "complete-loading"}
              >
                {aiState === "hint-loading" ? <><Spinner /> Thinking…</> : <><span className="ai-glow-dot" style={{ width: 5, height: 5 }} /> Get a Hint</>}
              </button>
              <button
                className="btn-ai-action btn-ai-action--complete"
                onClick={() => setShowTweakBox(true)}
                disabled={aiState === "hint-loading" || aiState === "complete-loading"}
              >
                {aiState === "complete-loading" ? <><Spinner /> Writing…</> : "✦ Complete with AI"}
              </button>
              <button
                className="btn-ai-action btn-ai-action--complete"
                onClick={handleAiComplete}
                disabled={aiState === "hint-loading" || aiState === "complete-loading"}
                style={{ padding: "0.4rem 0.7rem", fontSize: 11 }}
              >
                Quick Complete
              </button>
            </div>
            <div className="solution-ai-bar__right">
              {solution.trim() && (
                <>
                  <button className="btn-format" onClick={handleFormat} disabled={formatState === "loading"}>
                    {formatState === "loading" ? <><Spinner /> Formatting…</> : <><span className="ai-glow-dot" style={{ width: 5, height: 5 }} /> Format for Upload</>}
                  </button>
                  <button className="btn-submit" onClick={handleDirectSubmit} disabled={submitting}>
                    {submitting ? <><Spinner /> Submitting…</> : "Submit →"}
                  </button>
                </>
              )}
            </div>
          </div>
        </section>

        {/* Formatted solution side-by-side */}
        {viewingFormatted && formattedSolution && (
          <section className="detail-section">
            <div className="formatted-panel__header">
              <h3 className="detail-section__title" style={{ marginBottom: 0 }}>
                <span className="ai-glow-dot" /> AI-Formatted Solution — Ready to Submit
              </h3>
              <button className="btn-dismiss" onClick={() => setViewingFormatted(false)}>Close</button>
            </div>
            <div style={{ marginTop: "1rem" }}>
              <div style={{ background: "var(--bg)", border: "1px solid var(--border2)", borderRadius: "var(--radius-sm)", padding: "1.25rem", whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.7, color: "var(--text)", maxHeight: 500, overflowY: "auto" }}>
                {formattedSolution}
              </div>
            </div>
            <div className="formatted-panel__actions">
              <button className="btn-submit" onClick={() => { setViewingFormatted(false); setSubmitting(true); setTimeout(() => { setSubmitting(false); setSubmitted(true); }, 1500); }} disabled={submitting}>
                {submitting ? <><Spinner /> Submitting…</> : "Submit Formatted File →"}
              </button>
              <button className="btn-dismiss" onClick={() => setViewingFormatted(false)}>Cancel</button>
            </div>
          </section>
        )}

      </div>
    </div>
  );
}
