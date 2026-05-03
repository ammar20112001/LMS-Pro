"""Submit assignment file to VU LMS via Playwright."""

import logging
from pathlib import Path

from ..config import settings
from ..models import Item

log = logging.getLogger(__name__)


async def submit_assignment(item: Item, file_path: str) -> dict:
    """
    Upload file and click submit on VU LMS.
    Returns {"status": "success"|"error"|"unknown", "message": str}
    """
    from playwright.async_api import async_playwright

    if not Path(file_path).exists():
        return {"status": "error", "message": "File not found — generate the file first"}

    state_file = str(settings.state_file)
    if not Path(state_file).exists():
        return {"status": "error", "message": "Not logged in — open the app and log in first"}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(storage_state=state_file)
        page = await context.new_page()

        try:
            # Navigate to assignment submission page
            # VU LMS assignment URLs follow the pattern:
            # /Students/Assignment_View.aspx or similar — we use file_url from the item
            target_url = item.file_url or f"{settings.lms_url}Students/Course_Home.aspx"
            log.info("Navigating to: %s", target_url)
            await page.goto(target_url, wait_until="networkidle", timeout=30_000)

            # Find file input
            file_input = page.locator("input[type='file']").first
            if await file_input.count() == 0:
                return {"status": "error", "message": "No file upload field found on this page"}

            await file_input.set_input_files(file_path)
            log.info("File attached: %s", file_path)

            # Find and click upload button (VU LMS uses ASP.NET postback buttons)
            submit_btn = page.locator(
                "input[type='submit'][value*='Upload'], "
                "input[type='submit'][value*='Submit'], "
                "input[type='button'][value*='Upload'], "
                "button:has-text('Upload'), "
                "button:has-text('Submit')"
            ).first

            if await submit_btn.count() == 0:
                return {"status": "error", "message": "No submit button found on this page"}

            await submit_btn.click()
            await page.wait_for_load_state("networkidle", timeout=30_000)

            # Look for confirmation
            body_text = (await page.inner_text("body")).lower()
            success_signals = ["submitted", "uploaded successfully", "success", "thank you", "received"]
            error_signals = ["error", "failed", "invalid", "not allowed"]

            if any(s in body_text for s in success_signals):
                return {"status": "success", "message": "Assignment submitted successfully"}
            elif any(s in body_text for s in error_signals):
                return {"status": "error", "message": "LMS returned an error — please verify manually"}
            else:
                return {"status": "unknown", "message": "Submitted — please verify on LMS to confirm"}

        except Exception as e:
            log.exception("Submit failed for item %d: %s", item.id, e)
            return {"status": "error", "message": str(e)}

        finally:
            await context.close()
            await browser.close()
