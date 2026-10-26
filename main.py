import os
import secrets
import logging
from datetime import date, datetime
from typing import Optional, List
from contextlib import asynccontextmanager
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Depends, BackgroundTasks, HTTPException, Query, Header, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.openapi.docs import get_swagger_ui_html, get_redoc_html
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import func
from apscheduler.schedulers.background import BackgroundScheduler

from database import engine, get_db, SessionLocal
import models
import mailer

# Logger configured for instant visibility in Docker container output
logger = logging.getLogger("uvicorn.info")

# Environment Credentials
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
DOCS_USERNAME = os.getenv("DOCS_USERNAME", "admin")
DOCS_PASSWORD = os.getenv("DOCS_PASSWORD", ADMIN_PASSWORD)

# ------------------------------------------
# Authentication Guards
# ------------------------------------------
security = HTTPBasic()

def verify_docs_credentials(credentials: HTTPBasicCredentials = Depends(security)):
    """Enforces HTTP Basic Authentication on API documentation routes."""
    correct_username = secrets.compare_digest(credentials.username, DOCS_USERNAME)
    correct_password = secrets.compare_digest(credentials.password, DOCS_PASSWORD)
    if not (correct_username and correct_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username

def verify_admin_password(x_admin_password: Optional[str] = Header(None)):
    """Verifies admin session password for modifying records."""
    if not x_admin_password or x_admin_password.strip() != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid admin password")
    return True

# Initialize database schema
models.Base.metadata.create_all(bind=engine)

# Configurable scheduled IST hours (24-hour format)
SCHEDULED_HOURS: List[int] = [11, 13, 15, 17, 19, 21]

# Global scheduler instance
scheduler = BackgroundScheduler(timezone="Asia/Kolkata")


# ------------------------------------------
# Pydantic Schemas
# ------------------------------------------
class InspectionCreate(BaseModel):
    emp_id: str
    inspection_date: date
    theft_type: str
    load_book_no: str
    page_no: str
    assessed_load_kw: float = Field(..., gt=0, le=100.0, description="Load in kW between 0.01 and 100.00")

class InspectionUpdate(BaseModel):
    emp_id: str
    inspection_date: date
    theft_type: str
    load_book_no: str
    page_no: str
    assessed_load_kw: float = Field(..., gt=0, le=100.0, description="Load in kW between 0.01 and 100.00")


# ------------------------------------------
# Summary Query Helper
# ------------------------------------------
def compute_summaries(db: Session, from_date: Optional[date] = None, to_date: Optional[date] = None):
    query_circle = db.query(
        models.LoadInspection.circle,
        func.count(models.LoadInspection.id).label("total_cases"),
        func.sum(models.LoadInspection.assessed_load_kw).label("total_load_kw")
    )
    
    query_name = db.query(
        models.LoadInspection.emp_name,
        models.LoadInspection.emp_id,
        models.LoadInspection.circle,
        func.count(models.LoadInspection.id).label("total_cases"),
        func.sum(models.LoadInspection.assessed_load_kw).label("total_load_kw")
    )

    if from_date:
        query_circle = query_circle.filter(models.LoadInspection.inspection_date >= from_date)
        query_name = query_name.filter(models.LoadInspection.inspection_date >= from_date)
    if to_date:
        query_circle = query_circle.filter(models.LoadInspection.inspection_date <= to_date)
        query_name = query_name.filter(models.LoadInspection.inspection_date <= to_date)

    # Sort Circle Ascending
    circle_rows = query_circle.group_by(models.LoadInspection.circle).order_by(
        models.LoadInspection.circle.asc()
    ).all()
    
    # Sort Circle Ascending, then Employee Name Ascending
    name_rows = query_name.group_by(
        models.LoadInspection.emp_name,
        models.LoadInspection.emp_id,
        models.LoadInspection.circle
    ).order_by(
        models.LoadInspection.circle.asc(),
        models.LoadInspection.emp_name.asc()
    ).all()

    circle_summary = [
        {"circle": c, "total_cases": count, "total_load_kw": round(float(total_kw or 0), 2)}
        for c, count, total_kw in circle_rows
    ]
    name_summary = [
        {
            "emp_name": name,
            "emp_id": emp_id,
            "circle": c,
            "total_cases": count,
            "total_load_kw": round(float(total_kw or 0), 2)
        }
        for name, emp_id, c, count, total_kw in name_rows
    ]
    return circle_summary, name_summary


# ------------------------------------------
# Background Automated Job (Strictly Today IST)
# ------------------------------------------
def automated_daily_report_job():
    ist_now = datetime.now(ZoneInfo("Asia/Kolkata"))
    today_ist = ist_now.date()
    logger.info(f"⏰ [Scheduler] Executing automated dispatch strictly for TODAY: {today_ist} (IST)")
    db: Session = SessionLocal()
    try:
        circle_sum, name_sum = compute_summaries(db, from_date=today_ist, to_date=today_ist)
        success = mailer.send_summary_email(
            circle_summary=circle_sum,
            name_summary=name_sum,
            from_date=today_ist,
            to_date=today_ist
        )
        if success:
            logger.info(f"✅ [Scheduler] Report for {today_ist} dispatched successfully.")
        else:
            logger.warning("⚠️ [Scheduler] Email dispatch failed.")
    except Exception as e:
        logger.error(f"❌ [Scheduler Error]: {e}")
    finally:
        db.close()


# ------------------------------------------
# Application Lifespan
# ------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    cron_hours_str = ",".join(str(h) for h in sorted(SCHEDULED_HOURS))
    scheduler.add_job(
        automated_daily_report_job,
        trigger="cron",
        hour=cron_hours_str,
        minute=0,
        id="automated_vigilance_report",
        replace_existing=True
    )
    scheduler.start()
    logger.info(f"🚀 [Scheduler Active] Automated emails scheduled at hours [{cron_hours_str}] (Asia/Kolkata).")
    
    yield
    
    scheduler.shutdown()
    logger.info("🛑 [Scheduler Stopped] Background scheduler closed.")


# Initialize FastAPI app with default docs disabled for authentication protection
app = FastAPI(
    title="Vigilance Load Tracking System",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None
)

app.mount("/static", StaticFiles(directory="static"), name="static")


# ------------------------------------------
# Protected Documentation Routes
# ------------------------------------------
@app.get("/openapi.json", include_in_schema=False)
async def get_open_api_endpoint(username: str = Depends(verify_docs_credentials)):
    return app.openapi()

@app.get("/docs", include_in_schema=False)
async def get_documentation(username: str = Depends(verify_docs_credentials)):
    return get_swagger_ui_html(openapi_url="/openapi.json", title="API Documentation - Vigilance System")

@app.get("/redoc", include_in_schema=False)
async def get_redoc_documentation(username: str = Depends(verify_docs_credentials)):
    return get_redoc_html(openapi_url="/openapi.json", title="ReDoc Documentation - Vigilance System")


# ------------------------------------------
# Frontend Page Routes
# ------------------------------------------
@app.get("/")
def read_root():
    return FileResponse("static/index.html")

@app.get("/summary")
def read_summary():
    return FileResponse("static/summary.html")

@app.get("/admin")
def read_admin():
    return FileResponse("static/admin.html")


# ------------------------------------------
# Inspection & Master APIs
# ------------------------------------------
@app.get("/api/employees/{emp_id}")
def get_employee(emp_id: str, db: Session = Depends(get_db)):
    emp = db.query(models.Employee).filter(models.Employee.emp_id.ilike(emp_id.strip())).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    return {"emp_id": emp.emp_id, "name": emp.name, "circle": emp.circle, "team": emp.team}


@app.get("/api/inspections/check-page/{page_no}")
def check_duplicate_page(page_no: str, db: Session = Depends(get_db)):
    """Live validation check to see if page number already exists."""
    clean_page = page_no.strip()
    exists = db.query(models.LoadInspection).filter(
        models.LoadInspection.page_no == clean_page
    ).first()
    return {"exists": bool(exists)}


@app.post("/api/inspections")
def create_inspection(payload: InspectionCreate, db: Session = Depends(get_db)):
    clean_page = payload.page_no.strip()

    # Reject duplicate page number entries
    existing_record = db.query(models.LoadInspection).filter(
        models.LoadInspection.page_no == clean_page
    ).first()
    if existing_record:
        raise HTTPException(
            status_code=400,
            detail=f"Page Number '{clean_page}' has already been submitted under Book #{existing_record.load_book_no} by {existing_record.emp_name}."
        )

    emp = db.query(models.Employee).filter(models.Employee.emp_id.ilike(payload.emp_id.strip())).first()
    if not emp:
        raise HTTPException(status_code=400, detail="Invalid employee ID provided.")

    inspection = models.LoadInspection(
        emp_id=emp.emp_id,
        emp_name=emp.name,
        circle=emp.circle,
        team=emp.team,
        theft_type=payload.theft_type,
        load_book_no=payload.load_book_no.strip(),
        page_no=clean_page,
        assessed_load_kw=round(payload.assessed_load_kw, 2),
        inspection_date=payload.inspection_date
    )
    db.add(inspection)
    db.commit()
    return {"status": "success", "message": "Inspection recorded successfully."}


# ------------------------------------------
# Summary & Export APIs
# ------------------------------------------
@app.get("/api/summary")
def get_summary_data(
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    db: Session = Depends(get_db)
):
    circle_summary, name_summary = compute_summaries(db, from_date, to_date)
    return {"circle_summary": circle_summary, "name_summary": name_summary}


@app.get("/api/inspections/raw")
def get_raw_inspections(
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    db: Session = Depends(get_db)
):
    """Fetches all raw loadbook entries matching date filter for full Excel dump."""
    query = db.query(models.LoadInspection)
    if from_date:
        query = query.filter(models.LoadInspection.inspection_date >= from_date)
    if to_date:
        query = query.filter(models.LoadInspection.inspection_date <= to_date)
    
    rows = query.order_by(
        models.LoadInspection.inspection_date.desc(),
        models.LoadInspection.circle.asc(),
        models.LoadInspection.id.desc()
    ).all()

    return [
        {
            "id": r.id,
            "inspection_date": str(r.inspection_date),
            "circle": r.circle,
            "team": r.team or "",
            "emp_id": r.emp_id,
            "emp_name": r.emp_name,
            "theft_type": r.theft_type,
            "load_book_no": r.load_book_no,
            "page_no": r.page_no,
            "assessed_load_kw": float(r.assessed_load_kw)
        }
        for r in rows
    ]


@app.post("/api/summary/send-mail")
def manual_email_trigger(
    background_tasks: BackgroundTasks,
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    db: Session = Depends(get_db)
):
    circle_sum, name_sum = compute_summaries(db, from_date, to_date)
    background_tasks.add_task(mailer.send_summary_email, circle_sum, name_sum, from_date, to_date)
    return {"status": "queued", "message": "Summary report sent to management."}


# ------------------------------------------
# Scheduler Status Diagnostic
# ------------------------------------------
@app.get("/api/scheduler/status")
def get_scheduler_status():
    jobs = []
    for job in scheduler.get_jobs():
        jobs.append({
            "job_id": job.id,
            "next_run_time_ist": str(job.next_run_time),
            "is_running": scheduler.running
        })
    return {
        "scheduler_active": scheduler.running,
        "configured_hours_ist": SCHEDULED_HOURS,
        "jobs": jobs
    }


# ------------------------------------------
# Protected Admin APIs
# ------------------------------------------
@app.post("/api/admin/verify")
def check_admin_auth(payload: dict):
    entered_password = payload.get("password", "")
    if entered_password == ADMIN_PASSWORD:
        return {"status": "success", "message": "Authenticated"}
    raise HTTPException(status_code=401, detail="Incorrect password")


@app.get("/api/admin/inspections/by-page/{page_no}")
def get_inspections_by_page(
    page_no: str, 
    db: Session = Depends(get_db),
    authorized: bool = Depends(verify_admin_password)
):
    records = db.query(models.LoadInspection).filter(
        models.LoadInspection.page_no == page_no.strip()
    ).order_by(models.LoadInspection.id.desc()).all()
    
    if not records:
        raise HTTPException(status_code=404, detail="No inspection found with this Page Number")
    
    return [
        {
            "id": r.id,
            "emp_id": r.emp_id,
            "emp_name": r.emp_name,
            "circle": r.circle,
            "team": r.team,
            "theft_type": r.theft_type,
            "load_book_no": r.load_book_no,
            "page_no": r.page_no,
            "assessed_load_kw": float(r.assessed_load_kw),
            "inspection_date": str(r.inspection_date)
        }
        for r in records
    ]


@app.put("/api/admin/inspections/{record_id}")
def update_inspection(
    record_id: int, 
    payload: InspectionUpdate, 
    db: Session = Depends(get_db),
    authorized: bool = Depends(verify_admin_password)
):
    record = db.query(models.LoadInspection).filter(models.LoadInspection.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")

    clean_page = payload.page_no.strip()
    dup = db.query(models.LoadInspection).filter(
        models.LoadInspection.page_no == clean_page,
        models.LoadInspection.id != record_id
    ).first()
    if dup:
        raise HTTPException(status_code=400, detail=f"Page Number '{clean_page}' is already in use by Record #{dup.id}.")

    emp = db.query(models.Employee).filter(models.Employee.emp_id.ilike(payload.emp_id.strip())).first()
    if not emp:
        raise HTTPException(status_code=400, detail=f"Employee ID '{payload.emp_id}' not found in master records.")

    record.emp_id = emp.emp_id
    record.emp_name = emp.name
    record.circle = emp.circle
    record.team = emp.team
    record.inspection_date = payload.inspection_date
    record.theft_type = payload.theft_type
    record.load_book_no = payload.load_book_no.strip()
    record.page_no = clean_page
    record.assessed_load_kw = round(payload.assessed_load_kw, 2)

    db.commit()
    return {"status": "success", "message": f"Record updated successfully for {emp.name} ({emp.circle})!"}