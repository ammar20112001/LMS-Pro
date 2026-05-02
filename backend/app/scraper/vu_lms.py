"""
VU LMS Scraper (vulms.vu.edu.pk)
---------------------------------
ASP.NET WebForms + reCAPTCHA v3. Navigation is PostBack-based.
Session persisted to STATE_FILE after first headed login.

Discovered URL map (Spring 2026):
  Home:        https://vulms.vu.edu.pk/Home.aspx
  CourseHome:  https://vulms.vu.edu.pk/CourseHome.aspx  (after PostBack)
  Assignments: https://vulms.vu.edu.pk/Assignments/Assignments.aspx
  Quizzes:     https://vulms.vu.edu.pk/Quiz/QuizList.aspx
  GDB:         https://vulms.vu.edu.pk/GDB/Default.aspx
"""

import re
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse, parse_qs, unquote

from playwright.async_api import async_playwright, Browser, BrowserContext, Page

from ..config import settings

log = logging.getLogger(__name__)

LMS_HOME = settings.lms_url.rstrip("/") + "/Home.aspx"

DATE_FORMATS = [
    "%b %d, %Y %I:%M %p",   # "May 04, 2026 12:00 AM"
    "%b %d, %Y",             # "Apr 30, 2026"
]


def parse_date(raw: str) -> Optional[datetime]:
    if not raw:
        return None
    raw = raw.strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return None


@dataclass
class CourseDTO:
    index: int
    ctl_id: str
    postback_target: str
    code: str
    title: str


@dataclass
class ItemDTO:
    kind: str          # assignment | quiz | gdb
    lms_index: int
    title: str
    lesson: str = ""
    total_marks: str = ""
    status: str = ""
    opens_at: Optional[datetime] = None
    due_at: Optional[datetime] = None
    file_url: str = ""


@dataclass
class LectureDTO:
    week: int
    lms_index: int
    serial_no: int
    title: str
    has_video: bool = False
    has_reading: bool = False


class VULMSScraper:
    def __init__(self):
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None
        self._home_url: str = LMS_HOME

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self, headless: bool = True):
        from playwright.async_api import async_playwright as _apw
        self._pw = await _apw().start()
        self._browser = await self._pw.chromium.launch(headless=headless, slow_mo=100)

        state_file = str(settings.state_file)
        if Path(state_file).exists():
            self._context = await self._browser.new_context(
                storage_state=state_file,
                viewport={"width": 1280, "height": 900},
            )
        else:
            self._context = await self._browser.new_context(
                viewport={"width": 1280, "height": 900},
            )

        self._page = await self._context.new_page()

    async def stop(self):
        try:
            if self._context:
                await self._context.close()
        except Exception:
            pass
        try:
            if self._browser:
                await self._browser.close()
        except Exception:
            pass
        try:
            if hasattr(self, "_pw") and self._pw:
                await self._pw.stop()
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------

    async def ensure_logged_in(self) -> bool:
        """Check session; re-login if needed. Returns True if authenticated."""
        try:
            await self._page.goto(LMS_HOME, wait_until="networkidle", timeout=20000)
        except Exception as e:
            log.warning("Navigation to home failed: %s", e)
            return False

        current = self._page.url
        if "survey.vu.edu.pk" in current:
            current = await self._handle_survey_redirect(current)

        html = await self._page.content()
        if "txtStudentID" in html:
            log.info("Session expired — re-logging in")
            return await self.login(headless=True)

        self._home_url = self._page.url
        return True

    async def _handle_survey_redirect(self, current_url: str) -> str:
        qs = parse_qs(urlparse(current_url).query)
        lms_target = qs.get("LMS", [None])[0]
        if lms_target:
            lms_target = unquote(lms_target)
            await self._page.goto(lms_target, wait_until="networkidle", timeout=15000)
        else:
            await self._page.goto(LMS_HOME, wait_until="networkidle", timeout=15000)
        return self._page.url

    async def login(self, headless: bool = False) -> bool:
        """Full login flow. headless=False for first run (handles MFA/CAPTCHA naturally)."""
        from playwright.async_api import async_playwright as _apw
        if self._browser:
            await self.stop()

        self._pw = await _apw().start()
        self._browser = await self._pw.chromium.launch(headless=headless, slow_mo=150)
        self._context = await self._browser.new_context(viewport={"width": 1280, "height": 900})
        self._page = await self._context.new_page()

        await self._page.goto(settings.lms_url, wait_until="networkidle")

        # Wait for reCAPTCHA v3 token (invisible, browser handles it automatically)
        try:
            await self._page.wait_for_function(
                "document.getElementById('g-recaptcha-response') && "
                "document.getElementById('g-recaptcha-response').value !== ''",
                timeout=20000,
            )
        except Exception:
            log.warning("reCAPTCHA token not detected in time — proceeding anyway")

        await self._page.fill("#txtStudentID", settings.username)
        await self._page.fill("#txtPassword", settings.password)
        await self._page.click("#ibtnLogin")
        await self._wait_load()

        if "survey.vu.edu.pk" in self._page.url:
            await self._handle_survey_redirect(self._page.url)

        html = await self._page.content()
        if "txtStudentID" in html:
            log.error("Login failed — credentials may be wrong")
            return False

        await self._context.storage_state(path=str(settings.state_file))
        self._home_url = self._page.url
        log.info("Login OK. Home: %s", self._home_url)
        return True

    # ------------------------------------------------------------------
    # Navigation helpers
    # ------------------------------------------------------------------

    async def _wait_load(self):
        try:
            await self._page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            await self._page.wait_for_load_state("domcontentloaded", timeout=5000)

    async def _postback(self, event_target: str, event_argument: str = ""):
        async with self._page.expect_navigation(wait_until="networkidle", timeout=20000):
            await self._page.evaluate(f"""
                document.getElementById('__EVENTTARGET').value = '{event_target}';
                document.getElementById('__EVENTARGUMENT').value = '{event_argument}';
                document.getElementById('ctl00').submit();
            """)

    async def _goto_section(self, rel_url: str) -> Optional[str]:
        """Navigate to a course section URL. Returns HTML or None on error."""
        full_url = settings.lms_url.rstrip("/") + "/" + rel_url
        try:
            await self._page.goto(full_url, wait_until="networkidle", timeout=15000)
            html = await self._page.content()
            if len(html) < 6000 and ("Sorry" in html[:1000] or "error" in html.lower()[:500]):
                log.warning("Section %s returned error page", rel_url)
                return None
            return html
        except Exception as e:
            log.warning("Failed to load section %s: %s", rel_url, e)
            return None

    # ------------------------------------------------------------------
    # Course list
    # ------------------------------------------------------------------

    async def list_courses(self) -> list[CourseDTO]:
        await self._page.goto(self._home_url, wait_until="networkidle", timeout=15000)
        html = await self._page.content()
        return self._parse_courses(html)

    @staticmethod
    def _parse_courses(html: str) -> list[CourseDTO]:
        courses = []
        seen = set()

        # Extract unique course entries from ibtnCourseHome anchor IDs
        entries = re.findall(
            r'id="MainContent_gvCourseList_ibtnCourseHome_(\d+)"[^>]*title="([^"]+)"',
            html,
        )
        # Extract course codes from H3 tags: "CS401 - Computer Architecture..."
        code_pattern = re.compile(r'([A-Z]{2,4}\d+\w*)\s*-\s*([^<\n]+)')
        h3s = re.findall(r'<h3[^>]+>(.*?)</h3>', html, re.DOTALL)
        codes_titles: dict[int, tuple[str, str]] = {}
        for i, h3 in enumerate(h3s):
            m = code_pattern.search(re.sub(r'<[^>]+>', '', h3))
            if m:
                codes_titles[i] = (m.group(1).strip(), m.group(2).strip())

        for raw_idx, title in entries:
            idx = int(raw_idx)
            if idx in seen:
                continue
            seen.add(idx)
            ctl = f"ctl{idx:02d}"
            target = f"ctl00$MainContent$gvCourseList${ctl}$ibtnCourseHome"
            code, full_title = codes_titles.get(idx + 1, (f"COURSE{idx}", title))
            courses.append(CourseDTO(
                index=idx,
                ctl_id=ctl,
                postback_target=target,
                code=code,
                title=full_title or title,
            ))

        return courses

    # ------------------------------------------------------------------
    # Set course context + fetch sections
    # ------------------------------------------------------------------

    async def _set_course_context(self, course: CourseDTO):
        """Click course home button to establish server-side course session."""
        await self._page.goto(self._home_url, wait_until="networkidle", timeout=15000)
        await self._postback(course.postback_target)

    async def list_lectures(self, course: CourseDTO) -> list[LectureDTO]:
        await self._set_course_context(course)
        html = await self._goto_section("CourseHome.aspx")
        if not html:
            return []
        return self._parse_lectures(html)

    async def get_lecture_youtube_id(
        self, course: CourseDTO, week: int, lms_index: int
    ) -> str | None:
        """
        Click a specific lecture link and extract the YouTube video ID from the
        resulting iframe. Returns None if no YouTube embed is found.
        """
        await self._set_course_context(course)
        await self._goto_section("CourseHome.aspx")

        # Click the lecture view button to load the video panel
        btn_id = f"WeeklySchedule_rptIndex_{week}_lbtnViewLesson_{lms_index}"
        try:
            await self._page.click(f"#{btn_id}", timeout=8000)
            await self._page.wait_for_timeout(2000)
        except Exception:
            # Try postback approach
            target = f"ctl00$mainContent$WeeklySchedule$rptIndex${week}$lbtnViewLesson${lms_index}"
            await self._postback(target)

        html = await self._page.content()
        return self._extract_youtube_id(html)

    @staticmethod
    def _extract_youtube_id(html: str) -> str | None:
        """
        Extract YouTube video ID from page HTML.
        Handles embed URLs, watch URLs, and youtu.be short links.
        """
        patterns = [
            r'youtube\.com/embed/([A-Za-z0-9_-]{11})',
            r'youtube\.com/watch\?v=([A-Za-z0-9_-]{11})',
            r'youtu\.be/([A-Za-z0-9_-]{11})',
            r'"videoId"\s*:\s*"([A-Za-z0-9_-]{11})"',
        ]
        import re
        for pat in patterns:
            m = re.search(pat, html)
            if m:
                return m.group(1)
        return None

    @staticmethod
    def _parse_lectures(html: str) -> list["LectureDTO"]:
        entries = re.findall(
            r'WeeklySchedule_rptIndex_(\d+)_lbtnViewLesson_(\d+)"[^>]*title="([^"]+)"',
            html,
        )
        serials = {
            (int(w), int(l)): int(s)
            for w, l, s in re.findall(
                r'WeeklySchedule_rptIndex_(\d+)_lblLessonSrNo_(\d+)">(\d+)', html
            )
        }
        has_video = {
            (int(w), int(l))
            for w, l in re.findall(
                r'WeeklySchedule_rptIndex_(\d+)_rptLessonTabIcon_(\d+)_icon_\d+" class="fa fa-film', html
            )
        }
        has_reading = {
            (int(w), int(l))
            for w, l in re.findall(
                r'WeeklySchedule_rptIndex_(\d+)_rptLessonTabIcon_(\d+)_icon_\d+" class="fa fa-book', html
            )
        }
        lectures = []
        for w, l, title in entries:
            w, l = int(w), int(l)
            lectures.append(LectureDTO(
                week=w,
                lms_index=l,
                serial_no=serials.get((w, l), 0),
                title=title.strip(),
                has_video=(w, l) in has_video,
                has_reading=(w, l) in has_reading,
            ))
        return sorted(lectures, key=lambda x: x.serial_no)

    async def download_assignment_file(self, course: CourseDTO, lms_index: int) -> tuple[bytes, str]:
        """Download assignment file via PostBack. Returns (bytes, filename)."""
        await self._set_course_context(course)
        await self._goto_section("Assignments/Assignments.aspx")

        target = f"ctl00$MainContent$gvTileRepeaterAssignment$ctl{lms_index:02d}$lbtnViewAssignmentFile"
        try:
            async with self._page.expect_download(timeout=20000) as dl_info:
                await self._page.evaluate(f"""
                    document.getElementById('__EVENTTARGET').value = '{target}';
                    document.getElementById('__EVENTARGUMENT').value = '';
                    document.getElementById('ctl00').submit();
                """)
            download = await dl_info.value
            path = await download.path()
            with open(path, "rb") as f:
                data = f.read()
            filename = download.suggested_filename or "assignment_file"
            return data, filename
        except Exception as e:
            log.warning("Failed to download assignment file: %s", e)
            raise

    async def list_assignments(self, course: CourseDTO) -> list[ItemDTO]:
        await self._set_course_context(course)
        html = await self._goto_section("Assignments/Assignments.aspx")
        if not html:
            return []
        return self._parse_assignments(html)

    async def list_quizzes(self, course: CourseDTO) -> list[ItemDTO]:
        await self._set_course_context(course)
        html = await self._goto_section("Quiz/QuizList.aspx")
        if not html:
            return []
        return self._parse_quizzes(html)

    async def list_gdb(self, course: CourseDTO) -> list[ItemDTO]:
        await self._set_course_context(course)
        html = await self._goto_section("GDB/Default.aspx")
        if not html:
            return []
        return self._parse_gdb(html)

    # ------------------------------------------------------------------
    # Parsers
    # ------------------------------------------------------------------

    @staticmethod
    def _span_val(html: str, span_id: str) -> str:
        m = re.search(rf'id="{re.escape(span_id)}"[^>]*>([^<]*)<', html)
        return m.group(1).strip() if m else ""

    def _parse_assignments(self, html: str) -> list[ItemDTO]:
        items = []
        indices = sorted(set(
            int(x) for x in re.findall(r'gvTileRepeaterAssignment_pnl_(\d+)', html)
        ))
        for idx in indices:
            prefix = f"MainContent_gvTileRepeaterAssignment"
            title = self._span_val(html, f"{prefix}_Label3_{idx}")
            due_raw = self._span_val(html, f"{prefix}_lblDueDate_{idx}")
            marks = self._span_val(html, f"{prefix}_lblTotalMarks_{idx}")
            lesson = self._span_val(html, f"{prefix}_lblPayableAmount_{idx}")
            expired = self._span_val(html, f"{prefix}_lblExpired_{idx}")
            solution = re.search(rf'lbtnViewSolutionFile_{idx}', html)
            if solution:
                status = "Submitted"
            elif expired:
                status = "Expired"
            else:
                status = "Open"

            # File download link — the href on lbtnViewAssignmentFile
            file_url = ""
            m = re.search(
                rf'id="{prefix}_lbtnViewAssignmentFile_{idx}"[^>]*href="([^"]+)"',
                html,
            )
            if m:
                file_url = m.group(1)

            if not title:
                continue

            items.append(ItemDTO(
                kind="assignment",
                lms_index=idx,
                title=title,
                lesson=lesson,
                total_marks=marks,
                status=status,
                due_at=parse_date(due_raw),
                file_url=file_url,
            ))
        return items

    def _parse_quizzes(self, html: str) -> list[ItemDTO]:
        items = []
        indices = sorted(set(
            int(x) for x in re.findall(r'gvTileRepeaterQuiz_pnl_(\d+)', html)
        ))
        for idx in indices:
            prefix = "MainContent_gvTileRepeaterQuiz"
            title = self._span_val(html, f"{prefix}_lblTitle_{idx}")
            start_raw = self._span_val(html, f"{prefix}_lblStartDate_{idx}")
            end_raw = self._span_val(html, f"{prefix}_lblEndDate_{idx}")
            marks = self._span_val(html, f"{prefix}_lblTotalMarks_{idx}")
            submitted = self._span_val(html, f"{prefix}_lblSubmitted_{idx}")
            status = "Submitted" if submitted else "Open"

            if not title:
                continue

            items.append(ItemDTO(
                kind="quiz",
                lms_index=idx,
                title=title,
                total_marks=marks,
                status=status,
                opens_at=parse_date(start_raw),
                due_at=parse_date(end_raw),
            ))
        return items

    def _parse_gdb(self, html: str) -> list[ItemDTO]:
        items = []
        indices = sorted(set(
            int(x) for x in re.findall(r'gvTileRepeaterGDB_pnl_(\d+)', html)
        ))
        for idx in indices:
            prefix = "MainContent_gvTileRepeaterGDB"
            title = self._span_val(html, f"{prefix}_lblTitle_{idx}")
            due_raw = self._span_val(html, f"{prefix}_lblDueDate_{idx}")
            if not title:
                continue
            items.append(ItemDTO(
                kind="gdb",
                lms_index=idx,
                title=title,
                due_at=parse_date(due_raw),
            ))
        return items
