import os
import io
import smtplib
from datetime import date
from typing import Optional, List, Dict
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
from dotenv import load_dotenv
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

load_dotenv()

SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", 465))
SENDER_EMAIL = os.getenv("SENDER_EMAIL")
SENDER_PASSWORD = os.getenv("SENDER_PASSWORD")

raw_recipients = os.getenv("MANAGEMENT_EMAIL", "")
MANAGEMENT_EMAILS = [email.strip() for email in raw_recipients.split(",") if email.strip()]


def create_excel_report(circle_summary: List[Dict], name_summary: List[Dict], from_date: Optional[date] = None, to_date: Optional[date] = None) -> bytes:
    wb = openpyxl.Workbook()

    header_fill_circle = PatternFill(start_color="0B3954", end_color="0B3954", fill_type="solid")
    header_fill_name = PatternFill(start_color="087E8B", end_color="087E8B", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    thin_border = Border(
        left=Side(style='thin', color='DDDDDD'),
        right=Side(style='thin', color='DDDDDD'),
        top=Side(style='thin', color='DDDDDD'),
        bottom=Side(style='thin', color='DDDDDD')
    )

    # Sheet 1: Circle-Wise Summary
    ws_circle = wb.active
    ws_circle.title = "Circle Summary"
    ws_circle.append(["Circle", "Total Cases", "Booked Load (kW)"])

    for col in range(1, 4):
        cell = ws_circle.cell(row=1, column=col)
        cell.fill = header_fill_circle
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for row_idx, row in enumerate(circle_summary, start=2):
        ws_circle.append([row["circle"], row["total_cases"], round(row["total_load_kw"], 2)])
        for col_idx in range(1, 4):
            c = ws_circle.cell(row=row_idx, column=col_idx)
            c.border = thin_border
            if col_idx > 1:
                c.alignment = Alignment(horizontal="right")

    # Sheet 2: Name-Wise Summary
    ws_name = wb.create_sheet(title="Name Wise Summary")
    ws_name.append(["Employee Name", "Employee ID", "Circle", "Total Cases", "Booked Load (kW)"])

    for col in range(1, 6):
        cell = ws_name.cell(row=1, column=col)
        cell.fill = header_fill_name
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for row_idx, row in enumerate(name_summary, start=2):
        ws_name.append([row["emp_name"], row["emp_id"], row["circle"], row["total_cases"], round(row["total_load_kw"], 2)])
        for col_idx in range(1, 6):
            c = ws_name.cell(row=row_idx, column=col_idx)
            c.border = thin_border
            if col_idx > 3:
                c.alignment = Alignment(horizontal="right")

    # Auto-adjust column widths
    for ws in [ws_circle, ws_name]:
        for col in ws.columns:
            max_len = max(len(str(cell.value or "")) for cell in col)
            col_letter = openpyxl.utils.get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = max(max_len + 4, 14)

    excel_stream = io.BytesIO()
    wb.save(excel_stream)
    excel_stream.seek(0)
    return excel_stream.getvalue()


def send_summary_email(
    circle_summary: list, 
    name_summary: list, 
    from_date: Optional[date] = None, 
    to_date: Optional[date] = None
) -> bool:
    if not (SENDER_EMAIL and SENDER_PASSWORD and MANAGEMENT_EMAILS):
        print("SMTP credentials or management email recipients missing in .env.")
        return False

    date_label = "All Time"
    if from_date and to_date:
        date_label = f"{from_date} to {to_date}"
    elif from_date:
        date_label = f"From {from_date}"
    elif to_date:
        date_label = f"Up to {to_date}"

    msg = MIMEMultipart("mixed")
    msg["Subject"] = f"Electricity Vigilance: Circle & Name Wise Summary ({date_label})"
    msg["From"] = SENDER_EMAIL
    msg["To"] = ", ".join(MANAGEMENT_EMAILS)

    circle_rows = "".join(
        f"<tr><td style='padding:6px; border:1px solid #ccc;'>{row['circle']}</td>"
        f"<td style='padding:6px; border:1px solid #ccc; text-align:center;'>{row['total_cases']}</td>"
        f"<td style='padding:6px; border:1px solid #ccc; text-align:right;'>{row['total_load_kw']:.2f} kW</td></tr>"
        for row in circle_summary
    )
    name_rows = "".join(
        f"<tr><td style='padding:6px; border:1px solid #ccc;'>{row['emp_name']}</td>"
        f"<td style='padding:6px; border:1px solid #ccc; text-align:center;'>{row['emp_id']}</td>"
        f"<td style='padding:6px; border:1px solid #ccc;'>{row['circle']}</td>"
        f"<td style='padding:6px; border:1px solid #ccc; text-align:center;'>{row['total_cases']}</td>"
        f"<td style='padding:6px; border:1px solid #ccc; text-align:right;'>{row['total_load_kw']:.2f} kW</td></tr>"
        for row in name_summary
    )

    html_content = f"""
    <html>
    <body style="font-family: Arial, sans-serif; color: #222;">
        <h2>Executive Load Book & Vigilance Inspection Report</h2>
        <p><strong>Inspection Period:</strong> {date_label}</p>
        <p>Attached is the updated Excel sheet (<strong>Vigilance_Report_{date_label.replace(' ', '_')}.xlsx</strong>).</p>

        <h3>1. Circle-Wise Summary</h3>
        <table style="border-collapse: collapse; width: 100%; max-width: 550px;">
            <thead><tr style="background:#0b3954; color:#fff;"><th style="padding:8px;">Circle</th><th>Cases</th><th>Total Load</th></tr></thead>
            <tbody>{circle_rows}</tbody>
        </table>
        <br>
        <h3>2. Name-Wise Summary</h3>
        <table style="border-collapse: collapse; width: 100%; max-width: 650px;">
            <thead>
                <tr style="background:#087e8b; color:#fff;">
                    <th style="padding:8px;">Employee Name</th>
                    <th style="padding:8px;">Emp ID</th>
                    <th style="padding:8px;">Circle</th>
                    <th style="padding:8px;">Cases</th>
                    <th style="padding:8px;">Total Load</th>
                </tr>
            </thead>
            <tbody>{name_rows}</tbody>
        </table>
    </body>
    </html>
    """
    msg.attach(MIMEText(html_content, "html"))

    excel_bytes = create_excel_report(circle_summary, name_summary, from_date, to_date)
    attachment_name = f"Vigilance_Summary_{date_label.replace(' ', '_')}.xlsx"
    part = MIMEApplication(excel_bytes, Name=attachment_name)
    part["Content-Disposition"] = f'attachment; filename="{attachment_name}"'
    msg.attach(part)

    try:
        with smtplib.SMTP_SSL(SMTP_SERVER, SMTP_PORT, timeout=15) as server:
            server.login(SENDER_EMAIL, SENDER_PASSWORD)
            server.sendmail(SENDER_EMAIL, MANAGEMENT_EMAILS, msg.as_string())
        print(f"Management report sent for period: {date_label}")
        return True
    except Exception as e:
        print(f"SMTP Error: {e}")
        return False