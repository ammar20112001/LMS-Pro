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
  return { label: `${d}d left`, urgent: false, overdue: false };
}

type AiState = "idle" | "thinking" | "done";

interface AiMessage {
  prompt: string;
  response: string;
}

export function GDBDetail({ item, course, onBack }: Props) {
  const [response, setResponse] = useState("");
  const [submitted, setSubmitted] = useState(
    item.status === "Submitted" || Boolean(item.completed_at)
  );
  const [submitting, setSubmitting] = useState(false);

  const [aiPrompt, setAiPrompt] = useState("");
  const [aiState, setAiState] = useState<AiState>("idle");
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);

  const wordCount = response.trim() ? response.trim().split(/\s+/).length : 0;
  const time = timeUntil(item.due_at);
  const isOpen = item.status === "Open" || item.status === "Pending";

  async function handleAiSend() {
    if (!aiPrompt.trim() || aiState === "thinking") return;
    const prompt = aiPrompt;
    setAiPrompt("");
    setAiState("thinking");
    try {
      const res = await fetch("http://localhost:8000/api/ai/gdb-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_id: item.id,
          question: item.lesson ?? item.title,
          current_response: response,
          user_prompt: prompt,
        }),
      });
      const data = await res.json();
      setAiMessages((prev) => [...prev, { prompt, response: data.response ?? "Could not reach AI." }]);
    } catch {
      setAiMessages((prev) => [...prev, { prompt, response: "Could not reach AI. Please try again." }]);
    }
    setAiState("done");
    setTimeout(() => setAiState("idle"), 200);
  }

  function handleUseInEditor(text: string) {
    setResponse((prev) => prev ? prev + "\n\n" + text : text);
  }

  function handleSubmit() {
    if (!response.trim()) return;
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
          <div className="detail-meta__item"><span className="detail-meta__label">Status</span><span className="status-chip status-chip--submitted">✓ Submitted</span></div>
        </div>
        <div className="detail-body">
          <section className="detail-section">
            <div className="submission-success">
              <div className="submission-success__icon">✓</div>
              <div>
                <div className="submission-success__title">GDB Response Submitted</div>
                <div className="submission-success__sub">Your response has been posted</div>
              </div>
            </div>
          </section>
          <section className="detail-section">
            <h3 className="detail-section__title">Your Response</h3>
            <p style={{ fontSize: 14, lineHeight: 1.75, color: "var(--text)", whiteSpace: "pre-wrap" }}>{response}</p>
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
          <span className="course-detail__code" style={{ background: "oklch(0.72 0.14 210 / 0.15)", color: "var(--cyan)", border: "1px solid oklch(0.72 0.14 210 / 0.3)" }}>
            {item.course_code}
          </span>
          <span className="badge badge--gdb">GDB</span>
        </div>
        <h1 className="page__title" style={{ marginTop: "0.5rem" }}>{item.title}</h1>
      </div>

      <div className="detail-meta">
        <div className="detail-meta__item"><span className="detail-meta__label">Due Date</span><span className="detail-meta__value">{formatDue(item.due_at)}</span></div>
        {item.total_marks && <div className="detail-meta__item"><span className="detail-meta__label">Total Marks</span><span className="detail-meta__value">{item.total_marks}</span></div>}
        <div className="detail-meta__item"><span className="detail-meta__label">Status</span>
          <span className={`status-chip ${isOpen ? "status-chip--open" : "status-chip--pending"}`}>{item.status ?? "Pending"}</span>
        </div>
        {!time.overdue && item.due_at && (
          <div className="detail-meta__item"><span className="detail-meta__label">Time Left</span><span className={`detail-meta__value ${time.urgent ? "text-urgent" : ""}`}>{time.label}</span></div>
        )}
      </div>

      <div className="detail-body">

        {/* Professor's question */}
        <section className="detail-section">
          <h3 className="detail-section__title">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2 11V4a1 1 0 011-1h9a1 1 0 011 1v5a1 1 0 01-1 1H5l-3 2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>
            Discussion Question
          </h3>
          <div className="gdb-question">
            {item.lesson ?? item.title}
          </div>
        </section>

        {/* Response + AI panel */}
        <section className="detail-section">
          <h3 className="detail-section__title">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2 12L4.5 13 13 4.5 11.5 3 3 11.5 2 12z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
            Your Response
          </h3>

          <div className="gdb-columns">
            <div>
              <textarea
                className="gdb-textarea"
                placeholder={"Write your discussion response here.\n\nBe specific, cite concepts, and back your points with reasoning."}
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                rows={14}
              />
              <div className="gdb-textarea-footer">
                <span className="word-count">{wordCount} words</span>
                <button
                  className="btn-submit"
                  onClick={handleSubmit}
                  disabled={!response.trim() || submitting}
                >
                  {submitting ? "Submitting…" : "Post Response →"}
                </button>
              </div>
            </div>

            {/* AI Assistance Panel */}
            <div className="ai-panel">
              <div className="ai-panel__header">
                <span className="ai-glow-dot" /> Claude AI Assistance
              </div>
              <p style={{ fontSize: 12, color: "var(--text3)", marginTop: "-0.25rem" }}>
                Ask Claude to help you think through the discussion question
              </p>

              <div className="ai-input-row">
                <input
                  className="ai-input"
                  placeholder="Ask for help, examples, key points…"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleAiSend()}
                  disabled={aiState === "thinking"}
                />
                <button
                  className="btn-ai-send"
                  onClick={handleAiSend}
                  disabled={!aiPrompt.trim() || aiState === "thinking"}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 7h12M8 3l5 4-5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              </div>

              {aiState === "thinking" && (
                <div className="ai-thinking">
                  <div className="ai-thinking__dot" />
                  <div className="ai-thinking__dot" />
                  <div className="ai-thinking__dot" />
                  Thinking…
                </div>
              )}

              {aiMessages.map((msg, i) => (
                <div key={i} className="ai-response">
                  <div className="ai-response__header">
                    <span className="ai-glow-dot" style={{ width: 5, height: 5 }} />
                    Claude
                  </div>
                  <div className="ai-response__body">{msg.response}</div>
                  <button className="btn-use-in-editor" onClick={() => handleUseInEditor(msg.response)}>
                    + Use in editor
                  </button>
                </div>
              ))}

              {aiMessages.length === 0 && aiState !== "thinking" && (
                <div style={{ fontSize: 12, color: "var(--text3)", textAlign: "center", padding: "1rem 0" }}>
                  Ask Claude to help with key concepts, structure your argument, or find examples.
                </div>
              )}
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
