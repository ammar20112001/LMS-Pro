import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dashboard } from "./pages/Dashboard";
import { CoursePage } from "./pages/CoursePage";
import { CoursesPage } from "./pages/CoursesPage";
import { HandoutReader } from "./pages/HandoutReader";
import { AssignmentDetail } from "./pages/AssignmentDetail";
import { QuizDetail } from "./pages/QuizDetail";
import { GDBDetail } from "./pages/GDBDetail";
import { PipelinePage } from "./pages/PipelinePage";
import { StudyGuidePage } from "./pages/StudyGuidePage";
import { StudyCanvasPage } from "./pages/StudyCanvasPage";
import { Course, Item, Lecture } from "./api/client";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

type Page = "dashboard" | "courses" | "study" | "canvas" | "pipeline" | "chat" | "settings";

const NAV = [
  {
    id: "dashboard" as Page,
    label: "Dashboard",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="1" y="1" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="10" y="1" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="1" y="10" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="10" y="10" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
  },
  {
    id: "courses" as Page,
    label: "Courses",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 2L16 5.5V9C16 12.5 13 15.5 9 17C5 15.5 2 12.5 2 9V5.5L9 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M6 9l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: "study" as Page,
    label: "Study Guide",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M3 2h12a1 1 0 011 1v7a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M3 10v4a2 2 0 002 2h8a2 2 0 002-2v-4M7 6h4M7 8.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: "canvas" as Page,
    label: "Study Canvas",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="1" y="1" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="10" y="1" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="1" y="10" width="16" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M4 4.5h4M13 4.5h2M4 13.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: "pipeline" as Page,
    label: "Pipeline",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="4" r="2" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="9" cy="14" r="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M9 6v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="3" cy="9" r="2" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="15" cy="9" r="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M5 9h2M11 9h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: "chat" as Page,
    label: "AI Tutor",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 1.5C4.86 1.5 1.5 4.41 1.5 8c0 1.5.55 2.88 1.47 3.97L2 16.5l4.53-.97A7.94 7.94 0 009 16.5c4.14 0 7.5-2.91 7.5-6.5S13.14 1.5 9 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <circle cx="6" cy="8.5" r="1" fill="currentColor"/>
        <circle cx="9" cy="8.5" r="1" fill="currentColor"/>
        <circle cx="12" cy="8.5" r="1" fill="currentColor"/>
      </svg>
    ),
  },
  {
    id: "settings" as Page,
    label: "Settings",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M9 1v2M9 15v2M1 9h2M15 9h2M3.22 3.22l1.41 1.41M13.36 13.36l1.42 1.42M3.22 14.78l1.41-1.41M13.36 4.64l1.42-1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
];

function Sidebar({ active, onNav, expanded, onToggle }: {
  active: Page;
  onNav: (p: Page) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <aside className={`sidebar ${expanded ? "sidebar--expanded" : ""}`}>
      <div className="sidebar__logo" onClick={onToggle}>
        <div className="sidebar__logo-icon">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <rect x="2" y="2" width="8" height="8" rx="2" fill="currentColor" opacity="0.9"/>
            <rect x="12" y="2" width="8" height="8" rx="2" fill="currentColor" opacity="0.5"/>
            <rect x="2" y="12" width="8" height="8" rx="2" fill="currentColor" opacity="0.5"/>
            <rect x="12" y="12" width="8" height="8" rx="2" fill="currentColor" opacity="0.9"/>
          </svg>
        </div>
        {expanded && <span className="sidebar__logo-text">LMS<span>Pro</span></span>}
      </div>

      <nav className="sidebar__nav">
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`sidebar__item ${active === item.id ? "sidebar__item--active" : ""}`}
            onClick={() => onNav(item.id)}
            title={!expanded ? item.label : ""}
          >
            <span className="sidebar__item-icon">{item.icon}</span>
            {expanded && <span className="sidebar__item-label">{item.label}</span>}
          </button>
        ))}
      </nav>

      <button className="sidebar__toggle" onClick={onToggle} title={expanded ? "Collapse" : "Expand"}>
        {expanded ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        )}
        {expanded && <span>Collapse</span>}
      </button>
    </aside>
  );
}

const COURSE_COLORS = [
  "#6366f1","#8b5cf6","#06b6d4","#10b981","#f59e0b","#ef4444","#ec4899","#14b8a6",
];

type DrillState =
  | { type: "none" }
  | { type: "course"; course: Course }
  | { type: "assignment"; item: Item; course: Course | null }
  | { type: "quiz"; item: Item; course: Course | null }
  | { type: "gdb"; item: Item; course: Course | null }
  | { type: "handout"; lecture: Lecture; course: Course; courseIdx: number };

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [expanded, setExpanded] = useState(false);
  const [drill, setDrill] = useState<DrillState>({ type: "none" });
  const [allCourses, setAllCourses] = useState<Course[]>([]);

  function handleSelectItem(item: Item, courses: Course[]) {
    const course = courses.find((c) => c.id === item.course_id) ?? null;
    if (item.kind === "assignment") setDrill({ type: "assignment", item, course });
    else if (item.kind === "quiz") setDrill({ type: "quiz", item, course });
    else if (item.kind === "gdb") setDrill({ type: "gdb", item, course });
  }

  function handleSelectLecture(lecture: Lecture, course: Course, courseIdx: number) {
    setDrill({ type: "handout", lecture, course, courseIdx });
  }

  function handleBack() {
    if (drill.type === "handout") {
      setDrill({ type: "course", course: drill.course });
    } else {
      setDrill({ type: "none" });
    }
  }

  function handleNav(p: Page) {
    setPage(p);
    setDrill({ type: "none" });
  }

  function renderContent() {
    if (drill.type === "handout") {
      return (
        <HandoutReader
          lectureId={drill.lecture.id}
          courseId={drill.course.id}
          serialNo={drill.lecture.serial_no}
          lectureTitle={drill.lecture.title}
          course={drill.course}
          courseIndex={drill.courseIdx}
          onBack={handleBack}
        />
      );
    }

    if (drill.type === "course") {
      return (
        <CoursePage
          course={drill.course}
          onBack={handleBack}
          onSelectItem={(item) => handleSelectItem(item, allCourses)}
          onSelectLecture={(lec) => handleSelectLecture(lec, drill.course, allCourses.findIndex((c) => c.id === drill.course.id))}
        />
      );
    }
    if (drill.type === "assignment") {
      return <AssignmentDetail item={drill.item} course={drill.course} onBack={handleBack} />;
    }
    if (drill.type === "quiz") {
      return <QuizDetail item={drill.item} course={drill.course} onBack={handleBack} />;
    }
    if (drill.type === "gdb") {
      return <GDBDetail item={drill.item} course={drill.course} onBack={handleBack} />;
    }

    if (page === "dashboard") {
      return (
        <Dashboard
          onSelectItem={(item, courses) => {
            setAllCourses(courses);
            handleSelectItem(item, courses);
          }}
          onSelectCourse={(course) => {
            setAllCourses((prev) => {
              if (!prev.find((c) => c.id === course.id)) return [...prev, course];
              return prev;
            });
            setDrill({ type: "course", course });
          }}
          onSelectLecture={(lec, course, idx) => {
            setAllCourses((prev) => {
              if (!prev.find((c) => c.id === course.id)) return [...prev, course];
              return prev;
            });
            handleSelectLecture(lec, course, idx);
          }}
        />
      );
    }

    if (page === "courses") {
      return (
        <CoursesPage
          onSelectCourse={(course) => {
            setAllCourses((prev) => {
              if (!prev.find((c) => c.id === course.id)) return [...prev, course];
              return prev;
            });
            setDrill({ type: "course", course });
          }}
        />
      );
    }

    if (page === "study") {
      return <StudyGuidePage />;
    }

    if (page === "canvas") {
      return <StudyCanvasPage />;
    }

    if (page === "pipeline") {
      return <PipelinePage />;
    }

    if (page === "chat") {
      return (
        <div className="page">
          <div className="page__header">
            <h1 className="page__title">AI Tutor</h1>
            <p className="page__subtitle">Coming soon — Phase 4</p>
          </div>
          <div className="empty-state">AI Tutor will be available in Phase 4.</div>
        </div>
      );
    }

    if (page === "settings") {
      return (
        <div className="page">
          <div className="page__header">
            <h1 className="page__title">Settings</h1>
            <p className="page__subtitle">LMS credentials, notifications, sync interval</p>
          </div>
          <div className="empty-state">Settings page coming soon.</div>
        </div>
      );
    }

    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div className="app">
        <Sidebar
          active={drill.type !== "none" ? page : page}
          onNav={handleNav}
          expanded={expanded}
          onToggle={() => setExpanded((e) => !e)}
        />
        <main className="main">{renderContent()}</main>
      </div>
    </QueryClientProvider>
  );
}
