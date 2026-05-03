import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  getHint,
  completeWithAI,
  formatForUpload,
  submitAssignment,
  Item,
  Course,
} from "../api/client";

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string | null }) {
  const color =
    status === "Open"
      ? "bg-green-500/20 text-green-400 border-green-500/30"
      : status === "Closed" || status === "Expired"
      ? "bg-red-500/20 text-red-400 border-red-500/30"
      : "bg-zinc-700 text-zinc-400 border-zinc-600";
  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${color}`}>
      {status ?? "Unknown"}
    </span>
  );
}

// ── AI response panel ─────────────────────────────────────────────────────────

function AIPanel({ title, content }: { title: string; content: string }) {
  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 space-y-2">
      <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
        {title}
      </span>
      <pre className="text-sm text-zinc-100 whitespace-pre-wrap leading-relaxed max-h-52 overflow-y-auto">
        {content}
      </pre>
    </div>
  );
}

// ── File preview panel ────────────────────────────────────────────────────────

function FilePreviewPanel({
  fileUrl,
  filename,
  onSubmit,
  submitting,
  submitResult,
}: {
  fileUrl: string;
  filename: string;
  onSubmit: () => void;
  submitting: boolean;
  submitResult: { status: string; message: string } | null;
}) {
  return (
    <div className="flex flex-col h-full bg-zinc-800 border border-zinc-700 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 flex-wrap gap-2">
        <span className="text-sm font-medium text-zinc-300 truncate">{filename}</span>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a
            href={`http://localhost:8000${fileUrl}`}
            download={filename}
            className="text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 px-3 py-1.5 rounded transition"
          >
            Download
          </a>
          <button
            onClick={onSubmit}
            disabled={submitting}
            className="text-xs bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white px-3 py-1.5 rounded transition"
          >
            {submitting ? "Submitting…" : "Submit to LMS"}
          </button>
        </div>
      </div>

      {submitResult && (
        <div
          className={`px-4 py-2 text-sm font-medium ${
            submitResult.status === "success"
              ? "bg-green-500/20 text-green-300"
              : submitResult.status === "error"
              ? "bg-red-500/20 text-red-300"
              : "bg-yellow-500/20 text-yellow-300"
          }`}
        >
          {submitResult.message}
        </div>
      )}

      <div className="flex-1 flex items-center justify-center p-6 text-zinc-400 text-sm">
        <div className="text-center space-y-2">
          <div className="text-5xl">📄</div>
          <p className="font-medium text-zinc-300">{filename}</p>
          <p className="text-zinc-500">Download to review before submitting.</p>
        </div>
      </div>
    </div>
  );
}

// ── Main workspace ────────────────────────────────────────────────────────────

interface Props {
  item: Item;
  course: Course | null;
  onBack: () => void;
}

export default function AssignmentWorkspace({ item, course, onBack }: Props) {
  const [question, setQuestion] = useState("");
  const [solution, setSolution] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [generatedFile, setGeneratedFile] = useState<{
    filename: string;
    file_url: string;
  } | null>(null);
  const [submitResult, setSubmitResult] = useState<{
    status: string;
    message: string;
  } | null>(null);

  const hintMut = useMutation({
    mutationFn: () => getHint(item.id, question, solution),
    onSuccess: (d) => setHint(d.hint),
  });

  const completeMut = useMutation({
    mutationFn: () => completeWithAI(item.id, question),
    onSuccess: (d) => setSolution(d.solution),
  });

  const formatMut = useMutation({
    mutationFn: () => formatForUpload(item.id, question, solution),
    onSuccess: (d) => {
      setGeneratedFile(d);
      setSubmitResult(null);
    },
  });

  const submitMut = useMutation({
    mutationFn: () => submitAssignment(item.id, generatedFile!.filename),
    onSuccess: (d) => setSubmitResult(d),
  });

  const busy = hintMut.isPending || completeMut.isPending || formatMut.isPending;

  return (
    <div className="min-h-screen bg-zinc-900 text-zinc-100 flex flex-col">
      {/* Header */}
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center gap-4">
        <button
          onClick={onBack}
          className="text-zinc-400 hover:text-zinc-100 transition text-sm"
        >
          ← Back
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold truncate">{item.title}</h1>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-zinc-400">{item.course_code}</span>
            {item.lesson && (
              <span className="text-xs text-zinc-500">• {item.lesson}</span>
            )}
            {item.due_at && (
              <span className="text-xs text-zinc-500">
                • Due {new Date(item.due_at).toLocaleDateString()}
              </span>
            )}
            <StatusBadge status={item.status} />
            {item.total_marks && (
              <span className="text-xs text-zinc-500">• {item.total_marks} marks</span>
            )}
          </div>
        </div>
      </div>

      {/* Split layout */}
      <div className={`flex flex-1 overflow-hidden ${generatedFile ? "divide-x divide-zinc-800" : ""}`}>

        {/* Left: Editor */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

          {/* Question */}
          <div className="border-b border-zinc-800 p-4 space-y-2 flex-shrink-0">
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">
              Assignment Question
            </label>
            <textarea
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-100 resize-none focus:outline-none focus:border-indigo-500 transition"
              rows={4}
              placeholder="Paste the assignment question here…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>

          {/* Solution */}
          <div className="flex flex-col flex-1 p-4 space-y-2 min-h-0">
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">
              Your Solution
            </label>
            <textarea
              className="flex-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-100 font-mono resize-none focus:outline-none focus:border-indigo-500 transition"
              placeholder="Write your solution here…"
              value={solution}
              onChange={(e) => setSolution(e.target.value)}
            />
          </div>

          {/* AI panels */}
          {(hint || hintMut.isError || completeMut.isError || formatMut.isError) && (
            <div className="px-4 pb-3 space-y-3 flex-shrink-0 max-h-64 overflow-y-auto">
              {hint && <AIPanel title="Hint" content={hint} />}
              {hintMut.isError && (
                <p className="text-sm text-red-400">
                  Hint failed — {(hintMut.error as Error)?.message}
                </p>
              )}
              {completeMut.isError && (
                <p className="text-sm text-red-400">
                  Complete failed — {(completeMut.error as Error)?.message}
                </p>
              )}
              {formatMut.isError && (
                <p className="text-sm text-red-400">
                  Format failed — {(formatMut.error as Error)?.message}
                </p>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="border-t border-zinc-800 px-4 py-3 flex items-center gap-2 flex-wrap flex-shrink-0">
            <button
              onClick={() => hintMut.mutate()}
              disabled={!question.trim() || busy}
              className="text-sm bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-white px-4 py-2 rounded-lg transition"
            >
              {hintMut.isPending ? "Thinking…" : "💡 Get a Hint"}
            </button>

            <button
              onClick={() => completeMut.mutate()}
              disabled={!question.trim() || busy}
              className="text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-4 py-2 rounded-lg transition"
            >
              {completeMut.isPending ? "Writing…" : "✨ Complete with AI"}
            </button>

            <button
              onClick={() => formatMut.mutate()}
              disabled={!solution.trim() || !question.trim() || busy}
              className="text-sm bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white px-4 py-2 rounded-lg transition"
            >
              {formatMut.isPending ? "Generating…" : "📄 Format for Upload"}
            </button>

            {generatedFile && (
              <button
                onClick={() => submitMut.mutate()}
                disabled={submitMut.isPending}
                className="ml-auto text-sm bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white px-4 py-2 rounded-lg transition"
              >
                {submitMut.isPending ? "Submitting…" : "🚀 Submit"}
              </button>
            )}
          </div>
        </div>

        {/* Right: File preview */}
        {generatedFile && (
          <div className="w-[420px] flex-shrink-0 p-4">
            <FilePreviewPanel
              fileUrl={generatedFile.file_url}
              filename={generatedFile.filename}
              onSubmit={() => submitMut.mutate()}
              submitting={submitMut.isPending}
              submitResult={submitResult}
            />
          </div>
        )}
      </div>
    </div>
  );
}
