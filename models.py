from datetime import datetime, date
from sqlalchemy import Column, Integer, String, Float, DateTime, Date
from database import Base

class Employee(Base):
    __tablename__ = "employees"

    emp_id = Column(String(50), primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    circle = Column(String(100), nullable=False)
    team = Column(String(100), nullable=False)

class LoadInspection(Base):
    __tablename__ = "load_inspections"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    emp_id = Column(String(50), index=True, nullable=False)
    emp_name = Column(String(100), nullable=False)
    circle = Column(String(100), nullable=False)
    team = Column(String(100), nullable=False)
    theft_type = Column(String(20), nullable=False)      # DAE, DT, or MISUSE
    load_book_no = Column(String(50), nullable=False)
    page_no = Column(String(20), nullable=False)
    assessed_load_kw = Column(Float, nullable=False)
    inspection_date = Column(Date, default=date.today, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)