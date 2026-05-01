import asyncio
import logging
from fastapi import APIRouter, BackgroundTasks
from sqlalchemy.orm import Session
from fastapi import Depends

from ..db import get_db
from ..models import SyncRun
from ..schemas import SyncRunOut

router = APIRouter(prefix="/api/sync", tags=["sync"])
log = logging.getLogger(__name__)


@router.post("", response_model=dict)
def trigger_sync(background_tasks: BackgroundTasks):
    """Kick off an ad-hoc sync in the background."""
    from ..jobs.sync_job import run_sync
    background_tasks.add_task(_run_sync_bg)
    return {"status": "sync started"}


def _run_sync_bg():
    from ..jobs.sync_job import run_sync
    try:
        asyncio.run(run_sync())
    except Exception as e:
        log.exception("Background sync failed: %s", e)


@router.get("/runs", response_model=list[SyncRunOut])
def list_runs(limit: int = 10, db: Session = Depends(get_db)):
    runs = db.query(SyncRun).order_by(SyncRun.started_at.desc()).limit(limit).all()
    return runs
