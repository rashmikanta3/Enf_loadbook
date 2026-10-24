import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Override system env variables with .env
load_dotenv(override=True)

raw_url = os.getenv("DATABASE_URL", "")

if not raw_url:
    raise ValueError("DATABASE_URL is missing. Please set it in your .env file.")

# Strip query parameters (like ?sslmode=... or ?ssl=...)
base_url = raw_url.split("?")[0]

# Remove any driver prefix (e.g. postgresql+asyncpg://, postgres://, postgresql://)
if "://" in base_url:
    _, address_part = base_url.split("://", 1)
else:
    address_part = base_url

# Explicitly construct the connection URL using psycopg2
CLEAN_URL = f"postgresql+psycopg2://{address_part}"

print(f" Connecting via: {CLEAN_URL.split('@')[-1]}")  # Logs host only for safety

engine = create_engine(
    CLEAN_URL,
    connect_args={"sslmode": "require"},
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()