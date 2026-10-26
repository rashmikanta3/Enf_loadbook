
function setToday() {
    const todayStr = new Date().toISOString().split('T')[0];
    document.getElementById('fromDate').value = todayStr;
    document.getElementById('toDate').value = todayStr;
}

function resetFilters() {
    setToday();
    fetchSummary();
}

async function fetchSummary() {
    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;
    const params = new URLSearchParams();
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);

    const dateLabel = fromDate ? `(${fromDate} to ${toDate})` : '';
    const genText = `Report Date: ${fromDate || 'All'}`;

    document.getElementById('circleReportTitle').innerText = `Circle Wise Summary ${dateLabel}`;
    document.getElementById('nameReportTitle').innerText = `Name Wise Summary ${dateLabel}`;
    document.getElementById('circleGeneratedAt').innerText = genText;
    document.getElementById('nameGeneratedAt').innerText = genText;

    try {
        const res = await fetch(`/api/summary?${params.toString()}`);
        const data = await res.json();
        renderSummaries(data);
    } catch (err) {
        console.error("Failed to load summaries", err);
    }
}

function renderSummaries(data) {
    // Render Circle Summary
    const cBody = document.getElementById('circleSummaryBody');
    const cFoot = document.getElementById('circleSummaryFoot');
    cBody.innerHTML = '';

    let totalCircleCases = 0;
    let totalCircleKw = 0;

    if (data.circle_summary.length === 0) {
        cBody.innerHTML = '<tr><td colspan="3" class="text-center">No inspection records found</td></tr>';
        cFoot.innerHTML = '';
    } else {
        data.circle_summary.forEach(row => {
            totalCircleCases += row.total_cases;
            totalCircleKw += row.total_load_kw;
            cBody.innerHTML += `
                        <tr>
                            <td><strong>${row.circle}</strong></td>
                            <td class="text-center">${row.total_cases}</td>
                            <td class="text-right">${row.total_load_kw.toFixed(2)}</td>
                        </tr>
                    `;
        });
        cFoot.innerHTML = `
                    <tr>
                        <td>TOTAL</td>
                        <td class="text-center">${totalCircleCases}</td>
                        <td class="text-right">${totalCircleKw.toFixed(2)}</td>
                    </tr>
                `;
    }

    // Render Name Summary (Sorted Circle-Wise)
    const nBody = document.getElementById('nameSummaryBody');
    const nFoot = document.getElementById('nameSummaryFoot');
    nBody.innerHTML = '';

    let totalNameCases = 0;
    let totalNameKw = 0;

    if (data.name_summary.length === 0) {
        nBody.innerHTML = '<tr><td colspan="5" class="text-center">No inspection records found</td></tr>';
        nFoot.innerHTML = '';
    } else {
        // Secondary fallback sort: Circle Ascending, then Name Ascending
        data.name_summary.sort((a, b) => {
            const cComp = a.circle.localeCompare(b.circle);
            return cComp !== 0 ? cComp : a.emp_name.localeCompare(b.emp_name);
        });

        data.name_summary.forEach(row => {
            totalNameCases += row.total_cases;
            totalNameKw += row.total_load_kw;
            nBody.innerHTML += `
                        <tr>
                            <td><strong>${row.circle}</strong></td>
                            <td>${row.emp_id}</td>
                            <td>${row.emp_name}</td>
                            <td class="text-center">${row.total_cases}</td>
                            <td class="text-right">${row.total_load_kw.toFixed(2)}</td>
                        </tr>
                    `;
        });
        nFoot.innerHTML = `
                    <tr>
                        <td colspan="3">TOTAL</td>
                        <td class="text-center">${totalNameCases}</td>
                        <td class="text-right">${totalNameKw.toFixed(2)}</td>
                    </tr>
                `;
    }
}

function getDateSuffix() {
    const f = document.getElementById('fromDate').value || 'date';
    const t = document.getElementById('toDate').value || 'date';
    return `${f}_to_${t}`;
}

// --- Export Functions ---
function downloadCircleExcel() {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.table_to_sheet(document.getElementById('circleTable'));
    XLSX.utils.book_append_sheet(wb, ws, "Circle Summary");
    XLSX.writeFile(wb, `Circle_Summary_${getDateSuffix()}.xlsx`);
}

function downloadCirclePNG() {
    const area = document.getElementById('circleCaptureArea');
    html2canvas(area, {
        scale: 3,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false
    }).then(canvas => {
        const link = document.createElement('a');
        link.download = `Circle_Summary_${getDateSuffix()}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
    });
}

function downloadNameExcel() {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.table_to_sheet(document.getElementById('nameTable'));
    XLSX.utils.book_append_sheet(wb, ws, "Name Wise Summary");
    XLSX.writeFile(wb, `Name_Summary_${getDateSuffix()}.xlsx`);
}

function downloadNamePNG() {
    const area = document.getElementById('nameCaptureArea');
    // High scale (3x) ensures crystal sharp, unblurred text across 70+ rows
    html2canvas(area, {
        scale: 3,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
        windowWidth: 1200 // Consistent width rendering
    }).then(canvas => {
        const link = document.createElement('a');
        link.download = `Name_Summary_${getDateSuffix()}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
    });
}

// --- Raw Records Full Dump Export ---
async function downloadAllRawRecords() {
    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;
    const params = new URLSearchParams();
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);

    try {
        const res = await fetch(`/api/inspections/raw?${params.toString()}`);
        const data = await res.json();

        if (!data || data.length === 0) {
            alert("No raw inspection records found for the selected dates.");
            return;
        }

        // Map raw records into readable spreadsheet columns
        const exportRows = data.map(r => ({
            "ID": r.id,
            "Inspection Date": r.inspection_date,
            "Circle": r.circle,
            "Team": r.team,
            "Employee ID": r.emp_id,
            "Employee Name": r.emp_name,
            "Theft Type": r.theft_type,
            "Load Book No": r.load_book_no,
            "Page No": r.page_no,
            "Assessed Load (kW)": r.assessed_load_kw
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(exportRows);
        XLSX.utils.book_append_sheet(wb, ws, "All Inspections");
        XLSX.writeFile(wb, `All_Vigilance_Records_${getDateSuffix()}.xlsx`);
    } catch (err) {
        console.error("Failed to download raw records:", err);
        alert("Failed to download raw inspection data.");
    }
}

async function sendMailNow() {
    const btn = document.getElementById('mailReportBtn');
    const statusDiv = document.getElementById('actionStatus');
    btn.disabled = true;
    btn.innerText = "Dispatching...";

    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;
    const params = new URLSearchParams();
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);

    try {
        const res = await fetch(`/api/summary/send-mail?${params.toString()}`, { method: 'POST' });
        const resData = await res.json();
        statusDiv.className = "alert success";
        statusDiv.innerText = resData.message || "Email queued successfully!";
        statusDiv.classList.remove('hidden');
    } catch (err) {
        statusDiv.className = "alert error";
        statusDiv.innerText = "Failed to trigger email.";
        statusDiv.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.innerText = "📧 Dispatch Email";
    }
}

window.onload = resetFilters;
