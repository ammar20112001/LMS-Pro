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

type PracticeAnswer = Record<number, string>;
type PracticeResult = Record<number, boolean>;

interface MCQ {
  question: string;
  options: { label: string; text: string }[];
  answer: string;
}

const SAMPLE_QUESTIONS: MCQ[] = [
  {
    question: "Which of the following best describes a pipelined processor?",
    options: [
      { label: "A", text: "Executes one instruction completely before starting the next" },
      { label: "B", text: "Overlaps execution of multiple instructions across different stages" },
      { label: "C", text: "Runs instructions in parallel on separate cores" },
      { label: "D", text: "Uses a queue to batch instructions before execution" },
    ],
    answer: "B",
  },
  {
    question: "What is a data hazard in a pipeline?",
    options: [
      { label: "A", text: "A situation where a branch causes incorrect fetch" },
      { label: "B", text: "A memory access that takes too long" },
      { label: "C", text: "A dependency where an instruction needs a result not yet available" },
      { label: "D", text: "An overflow in the register file" },
    ],
    answer: "C",
  },
  {
    question: "Forwarding (bypassing) is used to:",
    options: [
      { label: "A", text: "Eliminate all pipeline stalls" },
      { label: "B", text: "Pass a result directly from one pipeline stage to an earlier stage" },
      { label: "C", text: "Stall the pipeline until all hazards are resolved" },
      { label: "D", text: "Reduce the number of pipeline stages" },
    ],
    answer: "B",
  },
];

export function QuizDetail({ item, course, onBack }: Props) {
  const [practicing, setPracticing] = useState(false);
  const [answers, setAnswers] = useState<PracticeAnswer>({});
  const [submitted, setSubmitted] = useState(false);
  const [results, setResults] = useState<PracticeResult>({});

  const time = timeUntil(item.due_at);
  const isOpen = item.status === "Open";

  function handleAnswer(qIdx: number, label: string) {
    if (submitted) return;
    setAnswers((prev) => ({ ...prev, [qIdx]: label }));
  }

  function handleSubmitPractice() {
    const r: PracticeResult = {};
    SAMPLE_QUESTIONS.forEach((q, i) => { r[i] = answers[i] === q.answer; });
    setResults(r);
    setSubmitted(true);
  }

  const score = submitted ? Object.values(results).filter(Boolean).length : 0;

  return (
    <div className="page detail-page">
      <div className="page__header">
        <button className="btn-back" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Back
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.75rem" }}>
          <span className="course-detail__code" style={{ background: "oklch(0.62 0.2 295 / 0.15)", color: "var(--accent2)", border: "1px solid oklch(0.62 0.2 295 / 0.3)" }}>
            {item.course_code}
          </span>
          <span className="badge badge--quiz">QUIZ</span>
        </div>
        <h1 className="page__title" style={{ marginTop: "0.5rem" }}>{item.title}</h1>
      </div>

      <div className="detail-meta">
        <div className="detail-meta__item"><span className="detail-meta__label">Opens</span><span className="detail-meta__value">{formatDue(item.opens_at)}</span></div>
        <div className="detail-meta__item"><span className="detail-meta__label">Due Date</span><span className="detail-meta__value">{formatDue(item.due_at)}</span></div>
        {item.total_marks && <div className="detail-meta__item"><span className="detail-meta__label">Total Marks</span><span className="detail-meta__value">{item.total_marks}</span></div>}
        <div className="detail-meta__item"><span className="detail-meta__label">Status</span>
          <span className={`status-chip ${isOpen ? "status-chip--open" : "status-chip--pending"}`}>{item.status ?? "Upcoming"}</span>
        </div>
        {!time.overdue && item.due_at && (
          <div className="detail-meta__item"><span className="detail-meta__label">Time Left</span><span className={`detail-meta__value ${time.urgent ? "text-urgent" : ""}`}>{time.label}</span></div>
        )}
      </div>

      <div className="detail-body">

        {/* Open now banner */}
        {isOpen && (
          <section className="detail-section">
            <div className="open-quiz-banner">
              <div className="open-quiz-banner__pulse" />
              <div className="open-quiz-banner__body" style={{ position: "relative" }}>
                <div className="open-quiz-banner__title">⚡ Quiz is Open Now</div>
                <div className="open-quiz-banner__sub">Attempt it on LMS before {formatDue(item.due_at)}</div>
              </div>
              <a
                href="https://vulms.vu.edu.pk/"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary btn-primary--glow"
                style={{ position: "relative", textDecoration: "none" }}
              >
                Open on LMS →
              </a>
            </div>
          </section>
        )}

        {/* Lesson info */}
        {item.lesson && (
          <section className="detail-section">
            <h3 className="detail-section__title">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="5.5" stroke="currentColor" strokeWidth="1.4"/><path d="M7.5 5v3l2 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              Coverage
            </h3>
            <p className="detail-section__text">{item.lesson}</p>
          </section>
        )}

        {/* AI Practice Mode */}
        <section className="detail-section">
          <div className="practice-header">
            <div>
              <h3 className="detail-section__title" style={{ marginBottom: "0.2rem" }}>
                <span className="ai-glow-dot" /> AI Practice Mode
              </h3>
              <p className="detail-section__sub" style={{ marginBottom: 0 }}>
                Sample MCQs based on this quiz's topic to help you prepare
              </p>
            </div>
            {!practicing && (
              <button className="btn-practice" onClick={() => setPracticing(true)}>
                Start Practice →
              </button>
            )}
          </div>

          {practicing && !submitted && (
            <div className="practice-area">
              {SAMPLE_QUESTIONS.map((q, i) => (
                <div key={i} className="practice-q">
                  <div className="practice-q__num">Q{i + 1}</div>
                  <div className="practice-q__body">
                    <div className="practice-q__text">{q.question}</div>
                    <div className="practice-q__options">
                      {q.options.map((opt) => (
                        <label
                          key={opt.label}
                          className={`practice-option ${answers[i] === opt.label ? "practice-option--selected" : ""}`}
                          onClick={() => handleAnswer(i, opt.label)}
                        >
                          <span className="practice-option__label">{opt.label}</span>
                          {opt.text}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
              <button
                className="btn-submit"
                onClick={handleSubmitPractice}
                disabled={Object.keys(answers).length < SAMPLE_QUESTIONS.length}
                style={{ alignSelf: "flex-start" }}
              >
                Submit Practice →
              </button>
            </div>
          )}

          {submitted && (
            <div className="practice-area">
              <div className="practice-result">
                <div className="practice-result__score">{score}/{SAMPLE_QUESTIONS.length}</div>
                <div className="practice-result__label">
                  {score === SAMPLE_QUESTIONS.length ? "Perfect score!" : score >= SAMPLE_QUESTIONS.length / 2 ? "Good effort — review the wrong ones" : "Keep practicing!"}
                </div>
              </div>
              {SAMPLE_QUESTIONS.map((q, i) => (
                <div key={i} className={`practice-q ${results[i] ? "practice-q--correct" : "practice-q--wrong"}`}>
                  <div className="practice-q__num">Q{i + 1}</div>
                  <div className="practice-q__body">
                    <div className="practice-q__text">{q.question}</div>
                    <div className="practice-q__options">
                      {q.options.map((opt) => {
                        const isAnswer = opt.label === q.answer;
                        const isSelected = answers[i] === opt.label;
                        return (
                          <div
                            key={opt.label}
                            className={`practice-option ${isAnswer ? "practice-option--answer" : isSelected && !isAnswer ? "practice-option--wrong" : ""}`}
                          >
                            <span className="practice-option__label">{opt.label}</span>
                            {opt.text}
                            {isAnswer && " ✓"}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
              <button
                className="btn-practice"
                onClick={() => { setAnswers({}); setResults({}); setSubmitted(false); }}
                style={{ alignSelf: "flex-start" }}
              >
                Try Again
              </button>
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
