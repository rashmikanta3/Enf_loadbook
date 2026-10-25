import os
from datetime import date
from typing import Optional, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, BackgroundTasks, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func
from apscheduler.schedulers.background import BackgroundScheduler

from database import engine, get_db, SessionLocal
import models
import mailer

# Create database tables if they do not exist
models.Base.metadata.create_all(bind=engine)

# ==========================================
# ⏰ CONFIGURABLE SCHEDULED HOURS (24-Hour)
# ==========================================
SCHEDULED_HOURS: List[int] = [11, 13, 15, 17, 19, 21]


# ------------------------------------------
# Pydantic Schemas
# ------------------------------------------
class InspectionCreate(BaseModel):
    emp_id: str
    inspection_date: date
    theft_type: str
    load_book_no: str
    page_no: str
    assessed_load_kw: float


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

    circle_rows = query_circle.group_by(models.LoadInspection.circle).all()
    name_rows = query_name.group_by(
        models.LoadInspection.emp_name,
        models.LoadInspection.emp_id,
        models.LoadInspection.circle
    ).all()

    circle_summary = [
        {"circle": c, "total_cases": count, "total_load_kw": float(total_kw or 0)}
        for c, count, total_kw in circle_rows
    ]
    name_summary = [
        {
            "emp_name": name,
            "emp_id": emp_id,
            "circle": c,
            "total_cases": count,
            "total_load_kw": float(total_kw or 0)
        }
        for name, emp_id, c, count, total_kw in name_rows
    ]
    return circle_summary, name_summary


# ------------------------------------------
# Automated Background Job
# ------------------------------------------
def automated_daily_report_job():
    """Generates today's report and emails the Circle & Name summary with Excel attachment."""
    today = date.today()
    print(f"⏰ [Scheduler] Executing automated vigilance dispatch for date: {today}...")
    db: Session = SessionLocal()
    try:
        circle_sum, name_sum = compute_summaries(db, from_date=today, to_date=today)
        success = mailer.send_summary_email(
            circle_summary=circle_sum,
            name_summary=name_sum,
            from_date=today,
            to_date=today
        )
        if success:
            print(f"✅ [Scheduler] Report for {today} dispatched successfully.")
        else:
            print("⚠️ [Scheduler] Failed to dispatch report email.")
    except Exception as e:
        print(f"❌ [Scheduler Error]: {e}")
    finally:
        db.close()


# ------------------------------------------
# Lifespan: Start & Stop Background Scheduler
# ------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = BackgroundScheduler(timezone="Asia/Kolkata")
    
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
    print(f"🚀 [Scheduler Active] Automated emails scheduled at hours [{cron_hours_str}] (Asia/Kolkata).")
    
    yield
    
    scheduler.shutdown()
    print("🛑 [Scheduler Stopped] Background scheduler closed.")


app = FastAPI(title="Vigilance Load Tracking System", lifespan=lifespan)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")


# ------------------------------------------
# Frontend Page Routes
# ------------------------------------------
@app.get("/")
def read_root():
    return FileResponse("static/index.html")

@app.get("/summary")
def read_summary():
    return FileResponse("static/summary.html")


# ------------------------------------------
# API Endpoints
# ------------------------------------------
@app.get("/api/employees/{emp_id}")
def get_employee(emp_id: str, db: Session = Depends(get_db)):
    emp = db.query(models.Employee).filter(models.Employee.emp_id.ilike(emp_id.strip())).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    return {"emp_id": emp.emp_id, "name": emp.name, "circle": emp.circle, "team": emp.team}


@app.post("/api/inspections")
def create_inspection(
    payload: InspectionCreate,
    db: Session = Depends(get_db)
):
    """
    Saves inspection details to the database.
    Email sending is deliberately omitted here.
    """
    emp = db.query(models.Employee).filter(models.Employee.emp_id.ilike(payload.emp_id.strip())).first()
    if not emp:
        raise HTTPException(status_code=400, detail="Invalid employee ID provided.")

    inspection = models.LoadInspection(
        emp_id=emp.emp_id,
        emp_name=emp.name,
        circle=emp.circle,
        team=emp.team,
        theft_type=payload.theft_type,
        load_book_no=payload.load_book_no,
        page_no=payload.page_no,
        assessed_load_kw=payload.assessed_load_kw,
        inspection_date=payload.inspection_date
    )
    db.add(inspection)
    db.commit()

    return {"status": "success", "message": "Inspection recorded successfully."}


@app.get("/api/summary")
def get_summary_data(
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    db: Session = Depends(get_db)
):
    circle_summary, name_summary = compute_summaries(db, from_date, to_date)
    return {"circle_summary": circle_summary, "name_summary": name_summary}


@app.post("/api/summary/send-mail")
def manual_email_trigger(
    background_tasks: BackgroundTasks,
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Manual trigger from the Summary page to dispatch the report immediately.
    """
    circle_sum, name_sum = compute_summaries(db, from_date, to_date)
    background_tasks.add_task(
        mailer.send_summary_email, 
        circle_sum, 
        name_sum, 
        from_date, 
        to_date
    )
    return {"status": "queued", "message": "Summary report with Excel attachment sent to management."}