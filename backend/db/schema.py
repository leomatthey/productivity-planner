import os
from contextlib import contextmanager
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, Date, DateTime, ForeignKey, Integer, String, Text, create_engine,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

Base = declarative_base()


class Task(Base):
    __tablename__ = "tasks"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    title              = Column(Text, nullable=False)
    description        = Column(Text)
    status             = Column(Text, default="todo")       # todo | in_progress | done | cancelled
    priority           = Column(Text, default="medium")     # low | medium | high | urgent
    due_date           = Column(Date)
    project_id         = Column(Integer, ForeignKey("goals.id"), nullable=True)
    scheduled_at       = Column(DateTime)
    estimated_minutes  = Column(Integer)
    energy_level       = Column(Text)                       # low | medium | high
    tags               = Column(Text)                       # comma-separated
    created_at         = Column(DateTime, default=datetime.utcnow)
    updated_at         = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at         = Column(DateTime)

    project         = relationship("Goal", back_populates="tasks", foreign_keys=[project_id])
    calendar_events = relationship("CalendarEvent", back_populates="task")


class Goal(Base):
    __tablename__ = "goals"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    title          = Column(Text, nullable=False)
    description    = Column(Text)
    status         = Column(Text, default="active")         # active | paused | completed | archived
    target_date    = Column(Date)
    progress_pct   = Column(Integer, default=0)             # 0–100
    progress_mode  = Column(Text, default="manual")         # manual | auto
    parent_id      = Column(Integer, ForeignKey("goals.id"), nullable=True)
    color          = Column(String, nullable=True)          # hex colour e.g. #4F46E5
    created_at     = Column(DateTime, default=datetime.utcnow)
    updated_at     = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at     = Column(DateTime)

    tasks    = relationship("Task", back_populates="project", foreign_keys="Task.project_id")
    subgoals = relationship("Goal", back_populates="parent", foreign_keys="Goal.parent_id")
    parent   = relationship("Goal", back_populates="subgoals",
                            remote_side="Goal.id", foreign_keys="Goal.parent_id")


class CalendarEvent(Base):
    __tablename__ = "calendar_events"

    id                 = Column(Integer, primary_key=True, autoincrement=True)
    title              = Column(Text, nullable=False)
    description        = Column(Text)
    event_type         = Column(Text, default="personal")   # task_block | meeting | personal | reminder | google_import
    start_datetime     = Column(DateTime, nullable=False)
    end_datetime       = Column(DateTime, nullable=False)
    location           = Column(Text)
    task_id            = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    is_recurring       = Column(Boolean, default=False)
    recurrence_rule    = Column(Text)
    source             = Column(Text, default="local")      # local | google
    google_event_id    = Column(Text)
    google_calendar_id = Column(Text)
    is_read_only       = Column(Boolean, default=False)
    sync_stale         = Column(Boolean, default=False)
    created_at         = Column(DateTime, default=datetime.utcnow)
    deleted_at         = Column(DateTime)

    task = relationship("Task", back_populates="calendar_events")


class Habit(Base):
    __tablename__ = "habits"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    title           = Column(Text, nullable=False)
    description     = Column(Text)
    frequency       = Column(Text, default="daily")         # daily | weekdays | weekly | custom
    target_days     = Column(Text)                          # JSON array of day indices (0=Mon)
    time_of_day     = Column(Text, default="anytime")       # morning | afternoon | evening | anytime
    streak_current  = Column(Integer, default=0)
    streak_best     = Column(Integer, default=0)
    is_active       = Column(Boolean, default=True)
    created_at      = Column(DateTime, default=datetime.utcnow)

    completions = relationship("HabitCompletion", back_populates="habit")


class HabitCompletion(Base):
    __tablename__ = "habit_completions"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    habit_id        = Column(Integer, ForeignKey("habits.id"), nullable=False)
    completed_date  = Column(Date, nullable=False)
    completed_at    = Column(DateTime, default=datetime.utcnow)
    note            = Column(Text)

    habit = relationship("Habit", back_populates="completions")


class AIConversationHistory(Base):
    __tablename__ = "ai_conversation_history"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    session_id  = Column(Text, nullable=False)
    role        = Column(Text, nullable=False)               # user | assistant | tool
    content     = Column(Text)
    tool_name   = Column(Text)
    token_count = Column(Integer)
    created_at  = Column(DateTime, default=datetime.utcnow)


class UserPreferences(Base):
    __tablename__ = "user_preferences"

    key        = Column(Text, primary_key=True)
    value      = Column(Text)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ---------------------------------------------------------------------------
#  Engine / session globals
# ---------------------------------------------------------------------------
_engine = None
_SessionLocal = None


def db_init(db_path: str = "./data/planner.db"):
    """Create the SQLite database and all tables. Safe to call multiple times."""
    global _engine, _SessionLocal

    abs_path = os.path.abspath(db_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)

    _engine = create_engine(
        f"sqlite:///{abs_path}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(_engine)
    _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine, _SessionLocal


@contextmanager
def get_session():
    """Yield a transactional SQLAlchemy session; commit on success, rollback on error."""
    if _SessionLocal is None:
        raise RuntimeError("Database not initialised. Call db_init() first.")
    session = _SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
