from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import Settings

engine = create_engine(Settings.psql_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
