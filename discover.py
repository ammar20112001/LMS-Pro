"""
VU LMS Discovery Script — PostBack-aware
-----------------------------------------
Logs into vulms.vu.edu.pk and crawls all course sections using
ASP.NET PostBack navigation. Saves HTML samples to samples/.

Run: DISPLAY=:0 python3 discover.py
"""

import asyncio
import json
import os
import re
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote
from dotenv import load_dotenv
from playwright.async_api import async_playwright, Page

load_dotenv()

LMS_URL    = os.getenv("lms_url", "https://vulms.vu.edu.pk/")
USERNAME   = os.getenv("username")
PASSWORD   = os.getenv("password")
STATE_DIR  = Path.home() / ".lms-pro"
STATE_FILE = STATE_DIR / "state.json"
SAMPLES    = Path(__file__).parent / "samples"

STATE_DIR.mkdir(parents=True, exist_ok=True)
SAMPLES.mkdir(parents=True, exist_ok=True)


def save(name: str, html: str):
    p = SAMPLES / f"{name}.html"
    p.write_text(html, encoding="utf-8")
    size = len(html)
    print(f"    [saved] {p.name} ({size:,} bytes)")


async def wait_load(page: Page):
    try:
        await page.wait_for_load_state("networkidle", timeout=12000)
    except Exception:
        await page.wait_for_load_state("domcontentloaded", timeout=5000)


async def postback(page: Page, event_target: str, event_argument: str = ""):
    """Trigger an ASP.NET PostBack and wait for the page to reload."""
    async with page.expect_navigation(wait_until="networkidle", timeout=20000):
        await page.evaluate(f"""
            document.getElementById('__EVENTTARGET').value = '{event_target}';
            document.getElementById('__EVENTARGUMENT').value = '{event_argument}';
            document.getElementById('ctl00').submit();
        """)


async def login(page: Page) -> bool:
    print("Logging in...")
    await page.goto(LMS_URL, wait_until="networkidle")

    try:
        await page.wait_for_function(
            "document.getElementById('g-recaptcha-response') && document.getElementById('g-recaptcha-response').value !== ''",
            timeout=15000
        )
    except Exception:
        pass  # reCAPTCHA might already have fired

    await page.fill("#txtStudentID", USERNAME)
    await page.fill("#txtPassword", PASSWORD)
    await page.click("#ibtnLogin")
    await wait_load(page)

    current = page.url
    print(f"  Post-login URL: {current}")

    # VU redirects to survey.vu.edu.pk — extract real LMS URL from query param
    if "survey.vu.edu.pk" in current or "LMS=" in current:
        qs = parse_qs(urlparse(current).query)
        lms_target = qs.get("LMS", [None])[0]
        if lms_target:
            lms_target = unquote(lms_target)
            print(f"  Bypassing survey → {lms_target}")
            await page.goto(lms_target, wait_until="networkidle", timeout=15000)

    print(f"  Final URL: {page.url}")
    html = await page.content()
    if "txtStudentID" in html:
        print("  ERROR: Still on login page")
        return False
    print("  Logged in OK")
    return True


def parse_courses(html: str) -> list[dict]:
    """Parse the course list from the LMS home page HTML."""
    courses = []
    seen = set()

    # Extract unique course entries from ibtnCourseHome anchor IDs
    entries = re.findall(
        r'id="MainContent_gvCourseList_ibtnCourseHome_(\d+)"[^>]*title="([^"]+)"',
        html
    )
    for idx, title in entries:
        idx = int(idx)
        if idx not in seen:
            seen.add(idx)
            # Get course code from H3
            code_match = re.search(
                rf'gvCourseList_[a-zA-Z]+_{idx}"[^>]*>\s*(CS\d+\w*|MTH\d+\w*|ENG\d+\w*|PHY\d+\w*|PAK\d+\w*|[A-Z]{{2,4}}\d+\w*)',
                html
            )
            code = code_match.group(1) if code_match else f"COURSE{idx}"
            courses.append({
                "index": idx,
                "ctl_id": f"ctl{idx:02d}",
                "postback_target": f"ctl00$MainContent$gvCourseList$ctl{idx:02d}$ibtnCourseHome",
                "title": title,
                "code": code,
            })

    # Fallback: grab codes from H3 tags
    if not courses:
        h3s = re.findall(r'<h3[^>]+>(.*?)</h3>', html, re.DOTALL)
        for h3 in h3s:
            clean = re.sub(r'<[^>]+>', '', h3).strip()
            clean = re.sub(r'\s+', ' ', clean)
            if re.match(r'[A-Z]{2,4}\d+', clean):
                print(f"  H3 fallback: {clean}")

    return courses


async def crawl_course(page: Page, course: dict, home_url: str) -> dict:
    """Click into a course and extract all sections."""
    print(f"\n  Course [{course['index']}]: {course['code']} — {course['title'][:50]}")
    result = {**course, "assignments": [], "quizzes": [], "announcements": [],
              "lectures": [], "handouts": [], "sections_found": []}

    # Navigate back to home and trigger PostBack for this course
    await page.goto(home_url, wait_until="networkidle", timeout=15000)
    await wait_load(page)

    try:
        await postback(page, course["postback_target"])
    except Exception as e:
        print(f"    ERROR navigating to course: {e}")
        return result

    course_url = page.url
    html = await page.content()
    save(f"course_{course['code']}_home", html)
    print(f"    URL: {course_url}")

    # Parse navigation links on this course page
    links = re.findall(r'href=["\']([^"\']+)["\']', html)
    text_links = re.findall(r'<a[^>]+href=["\']([^"\'#][^"\']*)["\'][^>]*>([^<]+)</a>', html)

    section_keywords = {
        "assignment": "assignments",
        "quiz": "quizzes",
        "announcement": "announcements",
        "handout": "handouts",
        "lecture": "lectures",
        "video": "lectures",
        "content": "lectures",
        "gdb": "quizzes",
    }

    found_sections = {}
    for href, text in text_links:
        text_low = text.lower().strip()
        href_low = href.lower()
        for kw, cat in section_keywords.items():
            if kw in text_low or kw in href_low:
                if cat not in found_sections:
                    full_href = href if href.startswith("http") else LMS_URL.rstrip("/") + "/" + href.lstrip("/")
                    found_sections[cat] = {"href": full_href, "text": text.strip()}
                break

    # Also check postback buttons for sections
    pb_sections = re.findall(r"__doPostBack\('([^']+)','([^']*)'\)", html)
    for target, arg in pb_sections:
        target_low = target.lower()
        for kw, cat in section_keywords.items():
            if kw in target_low and cat not in found_sections:
                found_sections[cat] = {"postback_target": target, "postback_arg": arg}
                break

    # Known VU LMS section URLs (accessed directly after course context is set)
    known_sections = {
        "assignments": "Assignments/Assignments.aspx",
        "quizzes":     "Quizzes/Quizzes.aspx",
        "announcements": "CourseAnnouncement/Announcements.aspx",
        "lectures":    "Lectures/Lectures.aspx",
        "handouts":    "Handouts/Handouts.aspx",
        "gdb":         "GDB/GDB.aspx",
    }

    result["sections_found"] = []
    for cat, rel_url in known_sections.items():
        full_url = LMS_URL.rstrip("/") + "/" + rel_url
        try:
            await page.goto(full_url, wait_until="networkidle", timeout=12000)
            section_html = await page.content()

            # Check if it's an error page or a real page
            if "error" in section_html.lower()[:500] and len(section_html) < 6000:
                print(f"    [{cat}] → error/redirect page, skipping")
                continue

            save(f"course_{course['code']}_{cat}", section_html)
            result["sections_found"].append(cat)

            # Extract text rows for structure summary
            rows = re.findall(r'<tr[^>]*>(.*?)</tr>', section_html, re.DOTALL)
            items = []
            for row in rows[:20]:
                text = re.sub(r'<[^>]+>', ' ', row)
                text = re.sub(r'\s+', ' ', text).strip()
                if len(text) > 10:
                    items.append(text[:300])
            result[cat] = items[:15]

            # If page has details links, follow the first one
            detail_links = re.findall(
                r'href=["\']([^"\'#][^"\']*\.aspx[^"\']*)["\']',
                section_html, re.IGNORECASE
            )
            for dl in detail_links[:3]:
                if any(kw in dl.lower() for kw in ['detail', 'view', 'download', cat.rstrip('s')]):
                    d_url = dl if dl.startswith("http") else LMS_URL.rstrip("/") + "/" + dl.lstrip("/")
                    try:
                        await page.goto(d_url, wait_until="networkidle", timeout=10000)
                        detail_html = await page.content()
                        if len(detail_html) > 5000:
                            save(f"course_{course['code']}_{cat}_detail", detail_html)
                    except Exception:
                        pass
                    break

            # Re-establish course context for next section
            await page.goto(home_url, wait_until="networkidle", timeout=10000)
            await postback(page, course["postback_target"])

        except Exception as e:
            print(f"    [{cat}] ERROR: {e}")
            try:
                await page.goto(home_url, wait_until="networkidle", timeout=10000)
                await postback(page, course["postback_target"])
            except Exception:
                pass

    print(f"    Sections found: {result['sections_found']}")
    return result


async def main():
    print("=" * 60)
    print("VU LMS Discovery — PostBack Edition")
    print("=" * 60)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False, slow_mo=150)
        context = await browser.new_context(
            record_har_path=str(SAMPLES / "network.har"),
            viewport={"width": 1280, "height": 900},
        )
        page = await context.new_page()

        if not await login(page):
            await context.close()
            await browser.close()
            return

        home_url = page.url
        await context.storage_state(path=str(STATE_FILE))
        print(f"Session saved → {STATE_FILE}")

        # Save and parse home page
        home_html = await page.content()
        save("00_home", home_html)

        courses = parse_courses(home_html)
        print(f"\nFound {len(courses)} courses:")
        for c in courses:
            print(f"  [{c['index']}] {c['code']} — {c['title'][:60]}")

        structure = {
            "lms_url": LMS_URL,
            "home_url": home_url,
            "term": "Spring 2026",
            "courses": [],
        }

        # Crawl all courses
        for course in courses:
            detail = await crawl_course(page, course, home_url)
            structure["courses"].append(detail)

        # Also check global sections from home nav
        print("\n--- Global Nav Sections ---")
        global_sections = {
            "activity_calendar": "ctl00$lbtnActivityCalendar",
            "grade_book":        "ctl00$lbtnGradeBook",
            "notice_board":      "/NoticeBoard/NoticeBoard.aspx",
        }
        await page.goto(home_url, wait_until="networkidle", timeout=10000)
        for name, target in global_sections.items():
            try:
                if target.startswith("/"):
                    await page.goto(LMS_URL.rstrip("/") + target, wait_until="networkidle", timeout=10000)
                else:
                    await postback(page, target)
                save(f"global_{name}", await page.content())
                await page.goto(home_url, wait_until="networkidle", timeout=8000)
            except Exception as e:
                print(f"  [{name}] ERROR: {e}")

        await context.close()
        await browser.close()

    # Save structure
    out = SAMPLES / "structure.json"
    out.write_text(json.dumps(structure, indent=2, ensure_ascii=False))
    print(f"\nStructure saved → {out}")

    print("\n=== Files in samples/ ===")
    for f in sorted(SAMPLES.iterdir()):
        print(f"  {f.name:<55} {f.stat().st_size:>10,} bytes")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
