import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchPipelineStatus, retryLecture, setVideoYoutubeId, triggerNotesGeneration,
  PipelineLecture,
} from "../api/client";

// ── Stage funnel ────────────────────────────────────────────────────────────

type StageKey = "all" | "youtube_id" | "transcript" | "translation" | "handout";

interface StageCardProps {
  label: string;
  stageKey: StageKey;
  count: number;
  total: number;
  active: boolean;
  onClick: () => void;
  color: string;
}

function StageCard({ label, count, total, active, onClick, color }: StageCardProps) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <button className={`stage-card ${active ? "stage-card--active" : ""}`} onClick={onClick}>
      <div className="stage-card__label">{label}</div>
      <div className="stage-card__count" style={{ color }}>{count}</div>
      <div className="stage-card__bar">
        <div className="stage-card__bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="stage-card__pct">{pct}%</div>
    </button>
  );
}

// ── Stage pills per lecture row ─────────────────────────────────────────────

type PillStatus = "done" | "active" | "failed" | "pending" | "na";

function StagePill({ label, status }: { label: string; status: PillStatus }) {
  return (
    <span className={`stage-pill stage-pill--${status}`}>
      {label}
    </span>
  );
}

function LectureStagePills({ lec }: { lec: PipelineLecture }) {
  const ytStatus: PillStatus =
    lec.yt_status === "found" ? "done" :
    lec.yt_status === "none" ? "na" : "pending";

  const trStatus: PillStatus =
    lec.has_transcript ? "done" :
    lec.notes_status === "transcribing" ? "active" :
    lec.notes_status === "failed" ? "failed" :
    lec.yt_status === "found" ? "pending" : "na";

  const enStatus: PillStatus =
    lec.has_translation ? "done" :
    lec.has_transcript ? "pending" : "na";

  const hoStatus: PillStatus =
    lec.has_notes ? "done" :
    lec.notes_status === "generating" ? "active" :
    lec.has_transcript ? "pending" : "na";

  return (
    <div className="lec-stage-pills">
      <StagePill label="YT" status={ytStatus} />
      <StagePill label="TR" status={trStatus} />
      <StagePill label="EN" status={enStatus} />
      <StagePill label="HO" status={hoStatus} />
    </div>
  );
}

// ── Inline YouTube ID form ───────────────────────────────────────────────────

function YtIdForm({ lec, onSave }: { lec: PipelineLecture; onSave: (id: string) => void }) {
  const [value, setValue] = useState("");

  // If no LectureVideo row yet (unscraped), can't set YT ID via video endpoint
  if (lec.id === null) {
    return <span className="plec-status-badge">Pending scrape</span>;
  }

  return (
    <div className="yt-input-form">
      <input
        className="yt-input"
        placeholder="YouTube ID (11 chars)"
        value={value}
        onChange={(e) => setValue(e.target.value.trim())}
        maxLength={11}
      />
      <button className="btn-yt-save" disabled={value.length !== 11} onClick={() => onSave(value)}>
        Save
      </button>
    </div>
  );
}

// ── Lecture row ─────────────────────────────────────────────────────────────

function LectureRow({ lec }: { lec: PipelineLecture }) {
  const qc = useQueryClient();

  const retryMut = useMutation({
    mutationFn: () => retryLecture(lec.lecture_id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipeline"] }),
  });

  const ytMut = useMutation({
    mutationFn: (ytId: string) => setVideoYoutubeId(lec.id as number, ytId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipeline"] }),
  });

  const triggerMut = useMutation({
    mutationFn: () => triggerNotesGeneration(lec.lecture_id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipeline"] }),
  });

  const isActive = lec.notes_status === "transcribing" || lec.notes_status === "generating";
  const isFailed = lec.notes_status === "failed" && !lec.has_transcript;

  return (
    <div className={`plec-row ${isActive ? "plec-row--active" : ""} ${isFailed ? "plec-row--failed" : ""}`}>
      <span className="plec-row__course">{lec.course_code}</span>
      <span className="plec-row__serial">#{lec.lecture_serial}</span>
      <span className="plec-row__title">
        {lec.seq > 1 && <span className="plec-seq-badge">▶{lec.seq}</span>}
        {lec.lecture_title}
      </span>

      <LectureStagePills lec={lec} />

      <div className="plec-row__action">
        {lec.yt_status === "none" ? (
          <YtIdForm lec={lec} onSave={(id) => ytMut.mutate(id)} />
        ) : isFailed ? (
          <button className="btn-tiny btn-tiny--red" onClick={() => retryMut.mutate()} disabled={retryMut.isPending}>
            ↺ Retry {lec.transcript_retries > 0 && `(${lec.transcript_retries}/10)`}
          </button>
        ) : lec.yt_status === "found" && !lec.has_transcript && lec.notes_status === "pending" ? (
          <button className="btn-tiny" onClick={() => triggerMut.mutate()} disabled={triggerMut.isPending}>
            ▶ Run now
          </button>
        ) : isActive ? (
          <span className="plec-status-badge plec-status-badge--active">
            {lec.notes_status === "transcribing" ? "Transcribing…" : "Generating…"}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

function filterLectures(lecs: PipelineLecture[], stage: StageKey): PipelineLecture[] {
  switch (stage) {
    case "youtube_id": return lecs.filter((l) => l.yt_status !== "found");
    case "transcript": return lecs.filter((l) => l.yt_status === "found" && !l.has_transcript);
    case "translation": return lecs.filter((l) => l.has_transcript && !l.has_translation);
    case "handout": return lecs.filter((l) => l.has_translation && !l.has_notes);
    default: return lecs;
  }
}

export function PipelinePage() {
  const qc = useQueryClient();
  const [activeStage, setActiveStage] = useState<StageKey>("all");
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["pipeline"],
    queryFn: fetchPipelineStatus,
    refetchInterval: 8_000,
  });

  if (isLoading) return <div className="page"><div className="empty-state">Loading pipeline…</div></div>;
  if (error || !data) return <div className="page"><div className="empty-state">Failed to load pipeline.</div></div>;

  const { stages, lectures } = data;

  const stageCards: { key: StageKey; label: string; count: number; color: string }[] = [
    { key: "youtube_id", label: "YouTube ID",  count: stages.youtube_id,  color: "var(--accent)" },
    { key: "transcript", label: "Transcript",  count: stages.transcript,  color: "#06b6d4" },
    { key: "translation",label: "Translation", count: stages.translation, color: "#8b5cf6" },
    { key: "handout",    label: "Handout",     count: stages.handout,     color: "var(--green)" },
  ];

  let visible = filterLectures(lectures, activeStage);
  if (search.trim()) {
    const q = search.toLowerCase();
    visible = visible.filter(
      (l) => l.lecture_title.toLowerCase().includes(q) || l.course_code.toLowerCase().includes(q)
    );
  }

  const activeCount = lectures.filter(
    (l) => l.notes_status === "transcribing" || l.notes_status === "generating"
  ).length;

  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <div className="page__header">
        <div className="page__header-left">
          <h1 className="page__title">Pipeline</h1>
          <span className="page__subtitle">
            {stages.video} video lectures
            {activeCount > 0 && <span className="pipeline-live-badge">{activeCount} active</span>}
          </span>
        </div>
        <button className="btn-sync" onClick={() => qc.invalidateQueries({ queryKey: ["pipeline"] })}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M11.5 6.5A5 5 0 112.3 3.2M11.5 6.5V3M11.5 3H8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Refresh
        </button>
      </div>

      {/* Stage funnel */}
      <div className="stage-funnel">
        <button
          className={`stage-card stage-card--all ${activeStage === "all" ? "stage-card--active" : ""}`}
          onClick={() => setActiveStage("all")}
        >
          <div className="stage-card__label">All video</div>
          <div className="stage-card__count" style={{ color: "var(--text1)" }}>{stages.video}</div>
          <div className="stage-card__bar">
            <div className="stage-card__bar-fill" style={{ width: "100%", background: "var(--text3)" }} />
          </div>
          <div className="stage-card__pct">100%</div>
        </button>

        {stageCards.map((s) => (
          <div key={s.key} className="stage-funnel__item">
            <div className="stage-funnel__arrow">→</div>
            <StageCard
              label={s.label}
              stageKey={s.key}
              count={s.count}
              total={stages.video}
              active={activeStage === s.key}
              onClick={() => setActiveStage((prev) => prev === s.key ? "all" : s.key)}
              color={s.color}
            />
          </div>
        ))}
      </div>

      {/* Lecture list */}
      <div className="pipeline-panel" style={{ marginTop: "1.5rem" }}>
        <div className="plec-list-header">
          <div className="plec-list-header__count">
            {activeStage === "all" ? `${visible.length} lectures` : `${visible.length} need attention`}
            {search && ` · filtered`}
          </div>
          <input
            className="plec-search"
            placeholder="Search by title or course…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Column header */}
        <div className="plec-col-header">
          <span className="plec-col-header__course">Course</span>
          <span className="plec-col-header__serial">#</span>
          <span className="plec-col-header__title">Title</span>
          <span className="plec-col-header__stages">YT · TR · EN · HO</span>
          <span className="plec-col-header__action">Action</span>
        </div>

        <div className="plec-list">
          {visible.length === 0 ? (
            <div className="plec-empty">
              {activeStage === "all" ? "No video lectures found." : "All caught up at this stage."}
            </div>
          ) : (
            visible.map((l) => <LectureRow key={`${l.lecture_id}-${l.seq}`} lec={l} />)
          )}
        </div>
      </div>

      <div className="pipeline-footer">
        Notes job · every 3 min · 5 per batch · max 10 retries
        &nbsp;·&nbsp; YT · Transcript · EN = English translation · HO = Handout
      </div>
    </div>
  );
}
