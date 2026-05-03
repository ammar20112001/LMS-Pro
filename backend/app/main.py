import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import engine, Base
from .api import courses, items, sync, assignments
from .api.courses import notes_router, study_router
from .jobs import scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logging.getLogger("app.scraper").setLevel(logging.DEBUG)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables
    Base.metadata.create_all(bind=engine)
    # Start background jobs
    scheduler.start()
    yield
    scheduler.stop()


app = FastAPI(title="LMS-Pro API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(courses.router)
app.include_router(items.router)
app.include_router(sync.router)
app.include_router(notes_router)
app.include_router(study_router)
app.include_router(assignments.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
