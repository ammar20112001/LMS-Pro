from pathlib import Path
from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DB_PATH = Path.home() / ".lms-pro" / "lms.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def setup_fts() -> None:
    """Create FTS5 virtual table + triggers for section full-text search.

    Uses porter stemmer + BM25 ranking. Triggers keep the index in sync
    whenever handout_sections rows are inserted, updated, or deleted.
    Also backfills any existing rows not yet indexed.
    """
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
                title, body,
                tokenize='porter unicode61'
            )
        """))
        conn.execute(text("""
            CREATE TRIGGER IF NOT EXISTS sections_fts_ai
            AFTER INSERT ON handout_sections BEGIN
                INSERT INTO sections_fts(rowid, title, body)
                VALUES (new.id, new.title, COALESCE(new.body, ''));
            END
        """))
        conn.execute(text("""
            CREATE TRIGGER IF NOT EXISTS sections_fts_ad
            AFTER DELETE ON handout_sections BEGIN
                DELETE FROM sections_fts WHERE rowid = old.id;
            END
        """))
        conn.execute(text("""
            CREATE TRIGGER IF NOT EXISTS sections_fts_au
            AFTER UPDATE ON handout_sections BEGIN
                DELETE FROM sections_fts WHERE rowid = old.id;
                INSERT INTO sections_fts(rowid, title, body)
                VALUES (new.id, new.title, COALESCE(new.body, ''));
            END
        """))
        # Backfill existing sections not yet indexed
        conn.execute(text("""
            INSERT INTO sections_fts(rowid, title, body)
            SELECT id, title, COALESCE(body, '') FROM handout_sections
            WHERE id NOT IN (SELECT rowid FROM sections_fts)
        """))
        conn.commit()
