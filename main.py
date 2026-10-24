from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, Field
from datetime import date
from typing import Optional

from database import engine, Base, get_db
import models
import mailer

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Vigilance Load Book System")
app.mount("/static", StaticFiles(directory="static"), name="static")

class InspectionCreate(BaseModel):
    emp_id: str
    theft_type: str
    load_book_no: str
    page_no: str
    assessed_load_kw: float = Field(..., gt=0)
    inspection_date: date

def compute_summaries(db: Session, from_date: Optional[date] = None, to_date: Optional[date] = None):
    query_circle = db.query(
        models.LoadInspection.circle,
        func.count(models.LoadInspection.id).label("total_cases"),
        func.sum(models.LoadInspection.assessed_load_kw).label("total_load_kw")
    )
    
    # Changed from team to emp_name (including emp_id & circle for clarity)
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

@app.get("/")
def serve_index():
    return FileResponse("static/index.html")

@app.get("/summary")
def serve_summary_page():
    return FileResponse("static/summary.html")

@app.get("/api/employees/{emp_id}")
def get_employee(emp_id: str, db: Session = Depends(get_db)):
    emp = db.query(models.Employee).filter(models.Employee.emp_id.ilike(emp_id.strip())).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee ID not found")
    return {"emp_id": emp.emp_id, "name": emp.name, "circle": emp.circle, "team": emp.team}

@app.get("/api/summary")
def get_summary_data(
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    db: Session = Depends(get_db)
):
    circle_summary, name_summary = compute_summaries(db, from_date, to_date)
    return {"circle_summary": circle_summary, "name_summary": name_summary}


@app.post("/api/inspections")
def create_inspection(
    payload: InspectionCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    emp = db.query(models.Employee).filter(models.Employee.emp_id.ilike(payload.emp_id.strip())).first()
    if not emp:
        raise HTTPException(status_code=400, detail="Employee not found")

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

    return {"status": "success", "message": "Susessfully Save"}


@app.post("/api/summary/send-mail")
def manual_email_trigger(
    background_tasks: BackgroundTasks,
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    db: Session = Depends(get_db)
):
    circle_sum, name_sum = compute_summaries(db, from_date, to_date)
    background_tasks.add_task(
        mailer.send_summary_email, 
        circle_sum, 
        name_sum, 
        from_date, 
        to_date
    )
    return {"message": "Email report with Excel sheet sent."}