// ===================== CONFIG =====================
const REPORT_ORG_NAME = "Load Booking Performance Analysis";   // <-- change to your official office name
const REPORT_SUBTITLE = "Load Booking Review Report";

let lastData = { circle_summary: [], name_summary: [] };

// ===================== HELPERS =====================
function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDate(date) {
    return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
}

function getRangeText() {
    const f = document.getElementById('fromDate').value;
    const t = document.getElementById('toDate').value || f;
    if (!f) return 'All Dates';
    return f === t ? formatDate(f) : `${formatDate(f)} to ${formatDate(t)}`;
}

function getDateSuffix() {
    const f = document.getElementById('fromDate').value || 'date';
    const t = document.getElementById('toDate').value || 'date';
    return `${f}_to_${t}`;
}

function nowText() {
    return new Date().toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
    });
}

// ===================== TOAST + BUTTON FEEDBACK =====================
function ensureUiStyles() {
    if (document.getElementById('uiFeedbackStyles')) return;
    const s = document.createElement('style');
    s.id = 'uiFeedbackStyles';
    s.textContent = `
        #toastWrap{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;align-items:center;width:calc(100% - 32px);max-width:420px;pointer-events:none}
        .toast{pointer-events:auto;width:100%;padding:12px 16px;border-radius:10px;color:#fff;font-size:14px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.25);opacity:0;transform:translateY(12px);transition:all .25s ease}
        .toast.show{opacity:1;transform:translateY(0)}
        .toast.success{background:#16a34a}.toast.error{background:#dc2626}.toast.info{background:#1e3a8a}
        button.is-loading{opacity:.75;cursor:wait;pointer-events:none}
        button.is-done{background:#16a34a !important;color:#fff !important}
        button:active:not(:disabled){transform:scale(.96)}
        button{transition:transform .1s ease, background .2s ease}
        .spin{display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .7s linear infinite;vertical-align:-2px;margin-right:6px}
        @keyframes spin{to{transform:rotate(360deg)}}
        .perf-toggle{display:inline-flex;border:1.5px solid #1e3a8a;border-radius:8px;overflow:hidden}
        .perf-toggle button{border:none;background:#fff;color:#1e3a8a;padding:7px 12px;font-weight:700;cursor:pointer;border-radius:0}
        .perf-toggle button.perf-active{background:#1e3a8a;color:#fff}
        .btn-whatsapp{background:#25D366;color:#fff;border:none;border-radius:6px;padding:6px 10px;font-weight:600;cursor:pointer}
    `;
    document.head.appendChild(s);
    const wrap = document.createElement('div');
    wrap.id = 'toastWrap';
    document.body.appendChild(wrap);
}

function showToast(message, type = 'info', ms = 3000) {
    ensureUiStyles();
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    document.getElementById('toastWrap').appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 300);
    }, ms);
    if (navigator.vibrate) navigator.vibrate(type === 'error' ? [60, 40, 60] : 30);
}

// Runs fn with loading state on the button, then success/error toast
async function runAction(btn, loadingText, successMsg, fn) {
    ensureUiStyles();
    const original = btn ? btn.innerHTML : '';
    if (btn) {
        btn.classList.add('is-loading');
        btn.disabled = true;
        btn.innerHTML = `<span class="spin"></span>${loadingText}`;
    }
    showToast(loadingText, 'info', 1500);
    try {
        const result = await fn();
        if (result === false) return;               // action handled its own message
        showToast(typeof successMsg === 'function' ? successMsg(result) : successMsg, 'success');
        if (btn) {
            btn.classList.remove('is-loading');
            btn.classList.add('is-done');
            btn.innerHTML = '✔ Done';
            await new Promise(r => setTimeout(r, 1200));
        }
    } catch (err) {
        console.error(err);
        showToast(err.message || 'Something went wrong', 'error', 4000);
    } finally {
        if (btn) {
            btn.classList.remove('is-loading', 'is-done');
            btn.disabled = false;
            btn.innerHTML = original;
        }
    }
}

// ===================== FILTERS / FETCH =====================
function setToday() {
    const d = new Date();
    const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    document.getElementById('fromDate').value = todayStr;
    document.getElementById('toDate').value = todayStr;
}

function resetFilters(btn) {
    setToday();
    return fetchSummary(btn && btn.tagName ? btn : null, true);
}

async function fetchSummary(btn, silentOk) {
    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;
    if (fromDate && toDate && fromDate > toDate) {
        showToast('From Date cannot be after To Date', 'error');
        return;
    }
    const params = new URLSearchParams();
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);

    const dateLabel = fromDate ? `(${getRangeText()})` : '';
    document.getElementById('circleReportTitle').innerText = `Circle Wise Summary ${dateLabel}`;
    document.getElementById('nameReportTitle').innerText = `Name Wise Summary ${dateLabel}`;

    const load = async () => {
        const res = await fetch(`/api/summary?${params.toString()}`);
        if (!res.ok) throw new Error('Server error while loading summary');
        const data = await res.json();
        lastData = data;
        renderSummaries(data);
        renderPerfChart();
        await loadTheftAnalysis(params);
        return data;
    };

    if (btn) {
        await runAction(btn, 'Loading...', d => `Loaded ${d.circle_summary.length} circles, ${d.name_summary.length} employees`, load);
    } else {
        try { await load(); } catch (e) { console.error(e); showToast('Failed to load summaries', 'error'); }
    }
}

// ===================== RENDER =====================
function renderSummaries(data) {
    const cBody = document.getElementById('circleSummaryBody');
    const cFoot = document.getElementById('circleSummaryFoot');
    cBody.innerHTML = '';
    let totalCircleCases = 0, totalCircleKw = 0;

    if (data.circle_summary.length === 0) {
        cBody.innerHTML = '<tr><td colspan="3" class="text-center">No inspection records found</td></tr>';
        cFoot.innerHTML = '';
    } else {
        data.circle_summary.forEach(row => {
            totalCircleCases += row.total_cases;
            totalCircleKw += row.total_load_kw;
            cBody.innerHTML += `
                <tr>
                    <td><strong>${esc(row.circle)}</strong></td>
                    <td class="text-center">${row.total_cases}</td>
                    <td class="text-right">${row.total_load_kw.toFixed(2)}</td>
                </tr>`;
        });
        cFoot.innerHTML = `
            <tr>
                <td>TOTAL</td>
                <td class="text-center">${totalCircleCases}</td>
                <td class="text-right">${totalCircleKw.toFixed(2)}</td>
            </tr>`;
    }

    const nBody = document.getElementById('nameSummaryBody');
    const nFoot = document.getElementById('nameSummaryFoot');
    nBody.innerHTML = '';
    let totalNameCases = 0, totalNameKw = 0;

    if (data.name_summary.length === 0) {
        nBody.innerHTML = '<tr><td colspan="5" class="text-center">No inspection records found</td></tr>';
        nFoot.innerHTML = '';
    } else {
        data.name_summary.sort((a, b) => {
            const c = a.circle.localeCompare(b.circle);
            return c !== 0 ? c : a.emp_name.localeCompare(b.emp_name);
        });
        data.name_summary.forEach(row => {
            totalNameCases += row.total_cases;
            totalNameKw += row.total_load_kw;
            nBody.innerHTML += `
                <tr>
                    <td><strong>${esc(row.circle)}</strong></td>
                    <td>${esc(row.emp_id)}</td>
                    <td>${esc(row.emp_name)}</td>
                    <td class="text-center">${row.total_cases}</td>
                    <td class="text-right">${row.total_load_kw.toFixed(2)}</td>
                </tr>`;
        });
        nFoot.innerHTML = `
            <tr>
                <td colspan="3">TOTAL</td>
                <td class="text-center">${totalNameCases}</td>
                <td class="text-right">${totalNameKw.toFixed(2)}</td>
            </tr>`;
    }
}

// ===================== OFFICIAL REPORT IMAGE (WhatsApp friendly) =====================
// Built off-screen with inline styles so it always looks the same, on any phone or PC.
function buildOfficialReport(kind) {
    const isCircle = kind === 'circle';
    const rows = isCircle ? lastData.circle_summary : lastData.name_summary;
    const title = isCircle ? 'CIRCLE WISE LOAD BOOKING SUMMARY' : 'NAME WISE LOAD BOOKING SUMMARY';

    const totalCases = rows.reduce((a, r) => a + r.total_cases, 0);
    const totalKw = rows.reduce((a, r) => a + r.total_load_kw, 0);

    const th = (t, align = 'left', w = '') =>
        `<th style="padding:10px 8px;text-align:${align};${w ? `width:${w};` : ''}font-size:13px;font-weight:700;color:#fff;background:#1e3a8a;border:1px solid #1e3a8a">${t}</th>`;
    const td = (t, align = 'left', bold = false, bg = '') =>
        `<td style="padding:8px;text-align:${align};font-size:13px;color:#111827;border:1px solid #d1d5db;${bold ? 'font-weight:700;' : ''}${bg ? `background:${bg};` : ''}">${t}</td>`;

    let head, body = '', foot;
    if (isCircle) {
        head = th('S.No', 'center', '50px') + th('Circle') + th('Cases', 'center', '80px') + th('Total Load (kW)', 'right', '130px');
        rows.forEach((r, i) => {
            const bg = i % 2 ? '#f3f4f6' : '#ffffff';
            body += `<tr>${td(i + 1, 'center', false, bg)}${td(esc(r.circle), 'left', true, bg)}${td(r.total_cases, 'center', false, bg)}${td(r.total_load_kw.toFixed(2), 'right', false, bg)}</tr>`;
        });
        foot = `<tr>${td('', 'center', true, '#dbeafe')}${td('GRAND TOTAL', 'left', true, '#dbeafe')}${td(totalCases, 'center', true, '#dbeafe')}${td(totalKw.toFixed(2), 'right', true, '#dbeafe')}</tr>`;
    } else {
        head = th('S.No', 'center', '45px') + th('Circle', 'left', '110px') + th('Emp ID', 'left', '75px') + th('Employee Name') + th('Cases', 'center', '60px') + th('Load (kW)', 'right', '95px');
        rows.forEach((r, i) => {
            const bg = i % 2 ? '#f3f4f6' : '#ffffff';
            body += `<tr>${td(i + 1, 'center', false, bg)}${td(esc(r.circle), 'left', true, bg)}${td(esc(r.emp_id), 'left', false, bg)}${td(esc(r.emp_name), 'left', false, bg)}${td(r.total_cases, 'center', false, bg)}${td(r.total_load_kw.toFixed(2), 'right', false, bg)}</tr>`;
        });
        foot = `<tr>${td('', 'center', true, '#dbeafe')}${`<td colspan="3" style="padding:8px;font-size:13px;font-weight:700;border:1px solid #d1d5db;background:#dbeafe">GRAND TOTAL</td>`}${td(totalCases, 'center', true, '#dbeafe')}${td(totalKw.toFixed(2), 'right', true, '#dbeafe')}</tr>`;
    }

    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;left:-10000px;top:0;width:760px;background:#ffffff;font-family:"Segoe UI",Arial,Helvetica,sans-serif;border:3px solid #1e3a8a;';
    wrap.innerHTML = `
        <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff;padding:18px 20px;text-align:center">
            <div style="font-size:20px;font-weight:800;letter-spacing:1px">${esc(REPORT_ORG_NAME)}</div>
            <div style="font-size:13px;opacity:.9;margin-top:4px">${esc(REPORT_SUBTITLE)}</div>
        </div>
        <div style="padding:14px 20px 6px;text-align:center">
            <div style="font-size:16px;font-weight:800;color:#1e3a8a;letter-spacing:.5px">${title}</div>
            <div style="display:inline-block;margin-top:8px;background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;font-size:13px;font-weight:700;padding:5px 14px;border-radius:20px">
                📅 Period: ${esc(getRangeText())}
            </div>
        </div>
        <div style="display:flex;gap:10px;padding:10px 20px">
            <div style="flex:1;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px;text-align:center">
                <div style="font-size:11px;color:#166534;font-weight:700">TOTAL CASES</div>
                <div style="font-size:22px;font-weight:800;color:#166534">${totalCases}</div>
            </div>
            <div style="flex:1;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px;text-align:center">
                <div style="font-size:11px;color:#9a3412;font-weight:700">TOTAL LOAD (kW)</div>
                <div style="font-size:22px;font-weight:800;color:#9a3412">${totalKw.toFixed(2)}</div>
            </div>
        </div>
        <div style="padding:4px 20px 14px">
            <table style="width:100%;border-collapse:collapse">
                <thead><tr>${head}</tr></thead>
                <tbody>${body || '<tr><td colspan="6" style="padding:14px;text-align:center;color:#6b7280">No inspection records found</td></tr>'}</tbody>
                <tfoot>${body ? foot : ''}</tfoot>
            </table>
        </div>
        <div style="border-top:2px solid #1e3a8a;background:#f8fafc;padding:10px 20px;display:flex;justify-content:space-between;font-size:11px;color:#475569">
            <span>Generated: ${esc(nowText())}</span>
            <span>System generated report</span>
        </div>`;
    document.body.appendChild(wrap);
    return wrap;
}

async function renderReportBlob(kind) {
    if (typeof html2canvas === 'undefined') throw new Error('Image library not loaded. Check internet.');
    if (!lastData[kind === 'circle' ? 'circle_summary' : 'name_summary'].length) {
        throw new Error('No records to export for selected dates');
    }
    const node = buildOfficialReport(kind);
    try {
        const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
        return await new Promise((resolve, reject) =>
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not create image')), 'image/png'));
    } finally {
        node.remove();
    }
}

function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function buildShareText(kind) {
    const isCircle = kind === 'circle';
    const rows = isCircle ? lastData.circle_summary : lastData.name_summary;
    const cases = rows.reduce((a, r) => a + r.total_cases, 0);
    const kw = rows.reduce((a, r) => a + r.total_load_kw, 0);
    return `*${REPORT_ORG_NAME}*\n*${isCircle ? 'Circle' : 'Name'} Wise Load Booking Summary*\nPeriod: ${getRangeText()}\nTotal Cases: ${cases}\nTotal Load: ${kw.toFixed(2)} kW`;
}

// ===================== EXPORT ACTIONS =====================
function downloadReportImage(btn, kind) {
    const label = kind === 'circle' ? 'Circle' : 'Name';
    return runAction(btn, 'Preparing image...', 'Report image downloaded ✔ Ready to share on WhatsApp', async () => {
        const blob = await renderReportBlob(kind);
        saveBlob(blob, `${label}_Summary_${getDateSuffix()}.png`);
    });
}
const downloadCirclePNG = btn => downloadReportImage(btn, 'circle');
const downloadNamePNG = btn => downloadReportImage(btn, 'name');

// Opens the phone's share sheet (WhatsApp appears there). Falls back to download + WhatsApp text.
function shareReport(btn, kind) {
    const label = kind === 'circle' ? 'Circle' : 'Name';
    return runAction(btn, 'Preparing...', 'Share ready', async () => {
        const blob = await renderReportBlob(kind);
        const filename = `${label}_Summary_${getDateSuffix()}.png`;
        const file = new File([blob], filename, { type: 'image/png' });
        const text = buildShareText(kind);

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], text, title: `${label} Wise Summary` });
                return 'Shared';
            } catch (e) {
                if (e.name === 'AbortError') { showToast('Share cancelled', 'info'); return false; }
                throw e;
            }
        }
        // Desktop / unsupported browser fallback
        saveBlob(blob, filename);
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
        showToast('Image saved. Attach it in the WhatsApp chat that opened.', 'success', 5000);
        return false;
    });
}
const shareCircleWhatsApp = btn => shareReport(btn, 'circle');
const shareNameWhatsApp = btn => shareReport(btn, 'name');

function downloadTableExcel(btn, tableId, sheetName, filePrefix) {
    return runAction(btn, 'Creating Excel...', 'Excel downloaded ✔', async () => {
        if (typeof XLSX === 'undefined') throw new Error('Excel library not loaded. Check internet.');
        const table = document.getElementById(tableId);
        if (table.querySelectorAll('tbody td[colspan]').length) throw new Error('No records to export for selected dates');
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.table_to_sheet(table), sheetName);
        XLSX.writeFile(wb, `${filePrefix}_${getDateSuffix()}.xlsx`);
    });
}
const downloadCircleExcel = btn => downloadTableExcel(btn, 'circleTable', 'Circle Summary', 'Circle_Summary');
const downloadNameExcel = btn => downloadTableExcel(btn, 'nameTable', 'Name Wise Summary', 'Name_Summary');

async function downloadAllRawRecords(btn) {
    const params = new URLSearchParams();
    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);

    return runAction(btn, 'Fetching records...', d => `${d} records downloaded ✔`, async () => {
        const res = await fetch(`/api/inspections/raw?${params.toString()}`);
        if (!res.ok) throw new Error('Server error while fetching records');
        const data = await res.json();
        if (!data || data.length === 0) throw new Error('No raw records found for selected dates');

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
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exportRows), "All Inspections");
        XLSX.writeFile(wb, `All_Vigilance_Records_${getDateSuffix()}.xlsx`);
        return data.length;
    });
}

async function sendMailNow(btn) {
    const params = new URLSearchParams();
    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    const statusDiv = document.getElementById('actionStatus');

    return runAction(btn, 'Dispatching...', m => m, async () => {
        const res = await fetch(`/api/summary/send-mail?${params.toString()}`, { method: 'POST' });
        const resData = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(resData.detail || resData.message || 'Failed to send email');
        const msg = resData.message || 'Email queued successfully!';
        statusDiv.className = 'alert success';
        statusDiv.innerText = msg;
        return msg;
    });
}

// ===================== PERFORMANCE CHART (name wise, WhatsApp friendly) =====================
const PERF_ROWS_PER_IMAGE = 90;   // up to 90 people fit in ONE wide image
const PERF_COLUMNS = 3;           // columns side by side (wide + short image)
const PERF_IMG_WIDTH = 1500;      // export image width in px

function getPerfMetric() {
    const el = document.getElementById('perfMetric');
    return el ? el.value : 'kw';
}

let perfView = 'name';   // 'name' or 'circle'

function perfWord() { return perfView === 'circle' ? 'Circle' : 'Name'; }

// Layout depends on how many bars there are (70 people = 3 wide columns, ~10 circles = 1 column)
function perfLayout(n) {
    if (n > 45) return { cols: PERF_COLUMNS, w: PERF_IMG_WIDTH, f: 1.15, nameW: 190 };
    if (n > 20) return { cols: 2, w: 1100, f: 1.15, nameW: 190 };
    return { cols: 1, w: 800, f: 1.15, nameW: 220 };
}

function setPerfView(view) {
    perfView = view;
    const n = document.getElementById('perfViewName');
    const c = document.getElementById('perfViewCircle');
    if (n && c) {
        n.classList.toggle('perf-active', view === 'name');
        c.classList.toggle('perf-active', view === 'circle');
    }
    const h = document.getElementById('perfHeading');
    if (h) h.innerText = `Performance Analysis - ${perfWord()} Wise`;
    renderPerfChart();
    showToast(`Showing ${perfWord()} wise chart`, 'info', 1500);
}

function getPerfData(metric) {
    const key = metric === 'cases' ? 'total_cases' : 'total_load_kw';
    const source = perfView === 'circle'
        ? (lastData.circle_summary || []).map(r => ({ ...r, emp_name: r.circle, circle: '' }))
        : (lastData.name_summary || []);
    return [...source].sort((a, b) =>
        (b[key] - a[key]) || a.emp_name.localeCompare(b.emp_name));
}

function perfColor(rank, total, value) {
    if (!value) return '#9ca3af';                          // zero
    if (rank <= Math.ceil(total * 0.2)) return '#16a34a';  // top 20%
    if (rank > total - Math.ceil(total * 0.2)) return '#ea580c'; // bottom 20%
    return '#2563eb';
}

function perfPageHtml(rows, startRank, all, metric, page, pages, opts = {}) {
    const key = metric === 'cases' ? 'total_cases' : 'total_load_kw';
    const metricLabel = metric === 'cases' ? 'Number of Cases' : 'Total Load (kW)';
    const cols = opts.cols || 1;
    const f = opts.f || 1;
    const px = n => `${Math.round(n * f)}px`;
    const max = Math.max(...all.map(r => r[key]), 1);
    const total = all.length;
    const sumKw = all.reduce((a, r) => a + r.total_load_kw, 0);
    const sumCases = all.reduce((a, r) => a + r.total_cases, 0);
    const top = all[0];
    const zero = all.filter(r => !r[key]).length;

    const fmt = r => metric === 'cases' ? r.total_cases : r.total_load_kw.toFixed(2);
    const sub = r => metric === 'cases' ? `${r.total_load_kw.toFixed(2)} kW` : `${r.total_cases} cases`;

    const rowHtml = (r, rank) => {
        const pct = Math.max((r[key] / max) * 100, r[key] ? 2 : 0);
        return `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;margin-bottom:5px;border:1.5px solid #94a3b8;border-radius:6px;background:#ffffff">
            <div style="width:${px(26)};text-align:center;font-size:${px(12)};font-weight:800;color:#1e3a8a">${rank}</div>
            <div style="width:${opts.nameW || 170}px;min-width:0">
                <div style="font-size:${px(12)};font-weight:700;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.emp_name)}</div>
                <div style="font-size:${px(10)};color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.circle)}</div>
            </div>
            <div style="flex:1;background:#eef2f7;border-radius:4px;height:${px(16)};overflow:hidden">
                <div style="width:${pct}%;height:100%;background:${perfColor(rank, total, r[key])};border-radius:4px"></div>
            </div>
            <div style="width:${px(70)};text-align:right">
                <div style="font-size:${px(12)};font-weight:800;color:#111827">${fmt(r)}</div>
                <div style="font-size:${px(9)};color:#6b7280">${sub(r)}</div>
            </div>
        </div>`;
    };

    // Fill columns top-to-bottom, so ranks run 1..n down each column
    const perCol = Math.ceil(rows.length / cols);
    let colsHtml = '';
    for (let c = 0; c < cols; c++) {
        const chunk = rows.slice(c * perCol, (c + 1) * perCol);
        if (!chunk.length) continue;
        colsHtml += `<div>${chunk.map((r, i) => rowHtml(r, startRank + c * perCol + i)).join('')}</div>`;
    }

    const box = (label, val, bg, bd, fg) => `
        <div style="flex:1;background:${bg};border:1px solid ${bd};border-radius:8px;padding:8px 6px;text-align:center">
            <div style="font-size:${px(10)};color:${fg};font-weight:700">${label}</div>
            <div style="font-size:${px(16)};font-weight:800;color:${fg}">${val}</div>
        </div>`;

    const summary = page === 1 ? `
        <div style="display:flex;gap:8px;padding:6px 16px">
            ${box(perfView === 'circle' ? 'CIRCLES' : 'Team Leaders', total, '#eff6ff', '#bfdbfe', '#1e3a8a')}
            ${box('TOTAL CASES', sumCases, '#f0fdf4', '#bbf7d0', '#166534')}
            ${box('TOTAL kW', sumKw.toFixed(2), '#fff7ed', '#fed7aa', '#9a3412')}
            
        </div>
        <div style="padding:2px 16px 4px;font-size:${px(12)};color:#374151">
            🏆 <b>Top:</b> ${esc(top ? top.emp_name : '-')} (${top ? fmt(top) : '-'})
            ${zero ? ` &nbsp;|&nbsp; ⚠️ <b>No booking:</b> ${zero}` : ''}
        </div>` : '';

    const dot = c => `<span style="display:inline-block;width:10px;height:10px;background:${c};border-radius:2px"></span>`;
    const legend = `
        <div style="display:flex;gap:12px;flex-wrap:wrap;padding:4px 16px 8px;font-size:${px(11)};color:#374151">
            <span>${dot('#16a34a')} Top 20%</span><span>${dot('#2563eb')} Middle</span>
            <span>${dot('#ea580c')} Bottom 20%</span><span>${dot('#9ca3af')} Nil</span>
        </div>`;

    return `
        <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff;padding:22px 16px;text-align:center">
            <div style="font-size:${px(30)};font-weight:800;letter-spacing:1px">${esc(REPORT_ORG_NAME)}</div>
            <div style="font-size:${px(18)};opacity:.95;margin-top:6px;font-weight:600">Performance Analysis - ${perfWord()} Wise</div>
        </div>
        <div style="padding:10px 16px 4px;text-align:center">
            <div style="font-size:${px(22)};font-weight:800;color:#1e3a8a">RANKING BY ${metricLabel.toUpperCase()}</div>
            <div style="display:inline-block;margin-top:6px;background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;font-size:${px(16)};font-weight:700;padding:6px 18px;border-radius:24px">
                📅 ${esc(getRangeText())}${pages > 1 ? ` &nbsp;•&nbsp; Part ${page} of ${pages}` : ''}
            </div>
        </div>
        ${summary}
        ${legend}
        <div style="display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:0 28px;padding:0 16px 10px">${colsHtml}</div>
        <div style="border-top:2px solid #1e3a8a;background:#f8fafc;padding:8px 16px;display:flex;justify-content:space-between;font-size:${px(10)};color:#475569">
            <span>Generated: ${esc(nowText())}</span>
            <span>System generated report</span>
        </div>`;
}

function renderPerfChart() {
    const box = document.getElementById('perfChartPreview');
    if (!box) return;
    const metric = getPerfMetric();
    const all = getPerfData(metric);
    if (!all.length) {
        box.innerHTML = '<div class="text-center" style="padding:16px">No inspection records found</div>';
        return;
    }
    const L = perfLayout(all.length);
    const wide = window.innerWidth >= 1000 && L.cols > 1;
    const opt = wide ? { cols: L.cols, f: 1.1, nameW: 150 } : { nameW: L.cols === 1 ? 170 : 120 };
    box.innerHTML = `<div style="border:2px solid #1e3a8a;background:#fff;font-family:'Segoe UI',Arial,sans-serif;max-width:${wide ? L.w : 760}px;margin:0 auto">${perfPageHtml(all, 1, all, metric, 1, 1, opt)}</div>`;
}

// Builds one PNG per page of PERF_ROWS_PER_IMAGE people
async function renderPerfBlobs() {
    if (typeof html2canvas === 'undefined') throw new Error('Image library not loaded. Check internet.');
    const metric = getPerfMetric();
    const all = getPerfData(metric);
    if (!all.length) throw new Error('No records to export for selected dates');

    const L = perfLayout(all.length);
    const pages = Math.ceil(all.length / PERF_ROWS_PER_IMAGE);
    const blobs = [];
    for (let p = 0; p < pages; p++) {
        const start = p * PERF_ROWS_PER_IMAGE;
        const slice = all.slice(start, start + PERF_ROWS_PER_IMAGE);
        const node = document.createElement('div');
        node.style.cssText = `position:fixed;left:-10000px;top:0;width:${L.w}px;background:#fff;font-family:"Segoe UI",Arial,Helvetica,sans-serif;border:3px solid #1e3a8a;`;
        node.innerHTML = perfPageHtml(slice, start + 1, all, metric, p + 1, pages, { cols: L.cols, f: L.f, nameW: L.nameW });
        document.body.appendChild(node);
        try {
            const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
            blobs.push(await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('Could not create image')), 'image/png')));
        } finally {
            node.remove();
        }
    }
    return blobs;
}

function perfFileName(i, n) {
    return `Performance_${perfWord()}Wise_${getPerfMetric() === 'cases' ? 'Cases' : 'kW'}_${getDateSuffix()}${n > 1 ? `_part${i + 1}` : ''}.png`;
}

function downloadPerfImages(btn) {
    return runAction(btn, 'Preparing chart...', n => `${n} chart image${n > 1 ? 's' : ''} downloaded ✔ Ready for WhatsApp`, async () => {
        const blobs = await renderPerfBlobs();
        for (let i = 0; i < blobs.length; i++) {
            saveBlob(blobs[i], perfFileName(i, blobs.length));
            await new Promise(r => setTimeout(r, 500));
        }
        return blobs.length;
    });
}

function sharePerfWhatsApp(btn) {
    return runAction(btn, 'Preparing chart...', 'Share ready', async () => {
        const blobs = await renderPerfBlobs();
        const files = blobs.map((b, i) => new File([b], perfFileName(i, blobs.length), { type: 'image/png' }));
        const all = perfView === 'circle' ? (lastData.circle_summary || []) : (lastData.name_summary || []);
        const text = `*${REPORT_ORG_NAME}*\n*Performance Analysis - ${perfWord()} Wise*\nPeriod: ${getRangeText()}\n${perfView === 'circle' ? 'Circles' : 'Team Leaders'}: ${all.length}\nTotal Cases: ${all.reduce((a, r) => a + r.total_cases, 0)}\nTotal Load: ${all.reduce((a, r) => a + r.total_load_kw, 0).toFixed(2)} kW`;

        if (navigator.canShare && navigator.canShare({ files })) {
            try {
                await navigator.share({ files, text, title: 'Performance Analysis' });
                return 'Shared';
            } catch (e) {
                if (e.name === 'AbortError') { showToast('Share cancelled', 'info'); return false; }
                throw e;
            }
        }
        for (let i = 0; i < blobs.length; i++) {
            saveBlob(blobs[i], files[i].name);
            await new Promise(r => setTimeout(r, 500));
        }
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
        showToast('Images saved. Attach them in the WhatsApp chat that opened.', 'success', 5000);
        return false;
    });
}

// ===================== THEFT-TYPE ANALYSIS CHART (DAE / DT / MISUSE) =====================
let theftData = { theft_types: ['DAE', 'DT', 'MISUSE'], circle_analysis: [], team_analysis: [] };
let theftView = 'circle';   // 'circle' or 'team'

const THEFT_COLORS = { DAE: '#dc2626', DT: '#f59e0b', MISUSE: '#7c3aed' };
const THEFT_EXTRA_COLORS = ['#0891b2', '#16a34a', '#db2777', '#475569', '#92400e'];

function theftColor(type, idx) {
    return THEFT_COLORS[type] || THEFT_EXTRA_COLORS[(idx - 3 + THEFT_EXTRA_COLORS.length) % THEFT_EXTRA_COLORS.length];
}

function theftLayout(n) {
    if (n > 45) return { cols: 3, w: 1800, f: 1.15, nameW: 190 };
    if (n > 20) return { cols: 2, w: 1300, f: 1.15, nameW: 190 };
    return { cols: 1, w: 900, f: 1.15, nameW: 210 };
}

function getTheftMetric() {
    const el = document.getElementById('theftMetric');
    return el ? el.value : 'kw';
}

function theftWord() { return theftView === 'circle' ? 'Circle' : 'Team'; }

function getTheftRows(metric) {
    const key = metric === 'cases' ? 'cases' : 'kw';
    const src = theftView === 'circle' ? theftData.circle_analysis : theftData.team_analysis;
    const val = r => metric === 'cases' ? r.total_cases : r.total_load_kw;
    return [...(src || [])]
        .map(r => theftView === 'circle'
            ? { ...r, label: r.circle, sub: '' }
            : { ...r, label: r.emp_name || r.emp_id, sub: `${r.circle}${r.team ? ' • ' + r.team : ''}` })
        .sort((a, b) => (val(b) - val(a)) || a.label.localeCompare(b.label))
        .map(r => ({ ...r, _key: key }));
}

async function loadTheftAnalysis(params) {
    try {
        const res = await fetch(`/api/summary/theft-analysis?${params.toString()}`);
        if (!res.ok) throw new Error('theft analysis failed');
        theftData = await res.json();
    } catch (e) {
        console.error(e);
        theftData = { theft_types: ['DAE', 'DT', 'MISUSE'], circle_analysis: [], team_analysis: [] };
        showToast('Could not load DAE / DT / Misuse analysis', 'error');
    }
    renderTheftChart();
}

function setTheftView(view) {
    theftView = view;
    document.getElementById('theftViewCircle')?.classList.toggle('perf-active', view === 'circle');
    document.getElementById('theftViewTeam')?.classList.toggle('perf-active', view === 'team');
    const h = document.getElementById('theftHeading');
    if (h) h.innerText = `DAE / DT / Misuse Analysis - ${theftWord()} Wise`;
    renderTheftChart();
    showToast(`Showing ${theftWord()} wise analysis`, 'info', 1500);
}

function theftPageHtml(rows, startRank, all, metric, page, pages, opts = {}) {
    const types = theftData.theft_types;
    const cols = opts.cols || 1;
    const f = opts.f || 1;
    const px = n => `${Math.round(n * f)}px`;
    const isCases = metric === 'cases';
    const fmt = v => isCases ? String(v) : Number(v).toFixed(2);
    const pick = (r, t) => isCases ? (r.by_type[t] ? r.by_type[t].cases : 0) : (r.by_type[t] ? r.by_type[t].kw : 0);
    const total = r => isCases ? r.total_cases : r.total_load_kw;
    const max = Math.max(...all.map(total), 1);

    // Totals per type (for summary boxes)
    const typeTotals = types.map((t, i) => ({
        t, color: theftColor(t, i),
        cases: all.reduce((a, r) => a + (r.by_type[t] ? r.by_type[t].cases : 0), 0),
        kw: all.reduce((a, r) => a + (r.by_type[t] ? r.by_type[t].kw : 0), 0)
    }));
    const grandCases = all.reduce((a, r) => a + r.total_cases, 0);
    const grandKw = all.reduce((a, r) => a + r.total_load_kw, 0);

    const rowHtml = (r, rank) => {
        const barW = (total(r) / max) * 100;
        const segs = types.map((t, i) => {
            const v = pick(r, t);
            if (!v || !total(r)) return '';
            const share = (v / total(r)) * 100;
            return `<div style="width:${share}%;height:100%;background:${theftColor(t, i)};display:flex;align-items:center;justify-content:center;color:#fff;font-size:${px(10)};font-weight:700;overflow:hidden;white-space:nowrap">${share * barW / 100 >= 9 ? fmt(v) : ''}</div>`;
        }).join('');
        return `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;margin-bottom:5px;border:1.5px solid #94a3b8;border-radius:6px;background:#fff">
            <div style="width:${px(26)};text-align:center;font-size:${px(12)};font-weight:800;color:#1e3a8a">${rank}</div>
            <div style="width:${opts.nameW || 170}px;min-width:0">
                <div style="font-size:${px(12)};font-weight:700;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.label)}</div>
                ${r.sub ? `<div style="font-size:${px(10)};color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.sub)}</div>` : ''}
            </div>
            <div style="flex:1;background:#eef2f7;border-radius:4px;height:${px(20)};overflow:hidden">
                <div style="display:flex;width:${Math.max(barW, total(r) ? 3 : 0)}%;height:100%">${segs}</div>
            </div>
            <div style="width:${px(62)};text-align:right;font-size:${px(12)};font-weight:800;color:#111827">${fmt(total(r))}</div>
        </div>`;
    };

    const perCol = Math.ceil(rows.length / cols);
    let colsHtml = '';
    for (let c = 0; c < cols; c++) {
        const chunk = rows.slice(c * perCol, (c + 1) * perCol);
        if (!chunk.length) continue;
        colsHtml += `<div>${chunk.map((r, i) => rowHtml(r, startRank + c * perCol + i)).join('')}</div>`;
    }

    const typeBoxes = typeTotals.map(x => `
        <div style="flex:1;background:#fff;border:2px solid ${x.color};border-radius:8px;padding:8px 6px;text-align:center">
            <div style="font-size:${px(11)};color:${x.color};font-weight:800">${esc(x.t)}</div>
            <div style="font-size:${px(16)};font-weight:800;color:#111827">${x.cases} <span style="font-size:${px(10)};color:#6b7280;font-weight:600">cases</span></div>
            <div style="font-size:${px(11)};color:#374151;font-weight:700">${x.kw.toFixed(2)} kW</div>
        </div>`).join('');

    const summary = page === 1 ? `
        <div style="display:flex;gap:8px;padding:6px 16px">
            <div style="flex:1;background:#eff6ff;border:2px solid #1e3a8a;border-radius:8px;padding:8px 6px;text-align:center">
                <div style="font-size:${px(11)};color:#1e3a8a;font-weight:800">GRAND TOTAL</div>
                <div style="font-size:${px(16)};font-weight:800;color:#111827">${grandCases} <span style="font-size:${px(10)};color:#6b7280;font-weight:600">cases</span></div>
                <div style="font-size:${px(11)};color:#374151;font-weight:700">${grandKw.toFixed(2)} kW</div>
            </div>
            ${typeBoxes}
        </div>` : '';

    const legend = `
        <div style="display:flex;gap:14px;flex-wrap:wrap;padding:6px 16px 8px;font-size:${px(12)};color:#374151;font-weight:600">
            ${types.map((t, i) => `<span><span style="display:inline-block;width:12px;height:12px;background:${theftColor(t, i)};border-radius:2px"></span> ${esc(t)}</span>`).join('')}
        </div>`;

    return `
        <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff;padding:22px 16px;text-align:center">
            <div style="font-size:${px(30)};font-weight:800;letter-spacing:1px">${esc(REPORT_ORG_NAME)}</div>
            <div style="font-size:${px(18)};opacity:.95;margin-top:6px;font-weight:600">DAE / DT / Misuse Booking Analysis - ${theftWord()} Wise</div>
        </div>
        <div style="padding:10px 16px 4px;text-align:center">
            <div style="font-size:${px(22)};font-weight:800;color:#1e3a8a">${theftWord().toUpperCase()} WISE BY ${isCases ? 'NUMBER OF CASES' : 'LOAD (kW)'}</div>
            <div style="display:inline-block;margin-top:6px;background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;font-size:${px(16)};font-weight:700;padding:6px 18px;border-radius:24px">
                📅 ${esc(getRangeText())}${pages > 1 ? ` &nbsp;•&nbsp; Part ${page} of ${pages}` : ''}
            </div>
        </div>
        ${summary}
        ${legend}
        <div style="display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:0 28px;padding:0 16px 10px">${colsHtml}</div>
        <div style="border-top:2px solid #1e3a8a;background:#f8fafc;padding:8px 16px;display:flex;justify-content:space-between;font-size:${px(10)};color:#475569">
            <span>Generated: ${esc(nowText())}</span>
            <span>System generated report</span>
        </div>`;
}

function renderTheftChart() {
    const box = document.getElementById('theftChartPreview');
    if (!box) return;
    const metric = getTheftMetric();
    const all = getTheftRows(metric);
    if (!all.length) {
        box.innerHTML = '<div class="text-center" style="padding:16px">No inspection records found</div>';
        return;
    }
    const L = theftLayout(all.length);
    const wide = window.innerWidth >= 1000 && L.cols > 1;
    const opt = wide ? { cols: L.cols, f: 1.05, nameW: 150 } : { nameW: L.cols === 1 ? 150 : 110 };
    box.innerHTML = `<div style="border:2px solid #1e3a8a;background:#fff;font-family:'Segoe UI',Arial,sans-serif;max-width:${wide ? L.w : 760}px;margin:0 auto">${theftPageHtml(all, 1, all, metric, 1, 1, opt)}</div>`;
}

async function renderTheftBlobs() {
    if (typeof html2canvas === 'undefined') throw new Error('Image library not loaded. Check internet.');
    const metric = getTheftMetric();
    const all = getTheftRows(metric);
    if (!all.length) throw new Error('No records to export for selected dates');
    const L = theftLayout(all.length);
    const pages = Math.ceil(all.length / PERF_ROWS_PER_IMAGE);
    const blobs = [];
    for (let p = 0; p < pages; p++) {
        const start = p * PERF_ROWS_PER_IMAGE;
        const node = document.createElement('div');
        node.style.cssText = `position:fixed;left:-10000px;top:0;width:${L.w}px;background:#fff;font-family:"Segoe UI",Arial,Helvetica,sans-serif;border:3px solid #1e3a8a;`;
        node.innerHTML = theftPageHtml(all.slice(start, start + PERF_ROWS_PER_IMAGE), start + 1, all, metric, p + 1, pages, { cols: L.cols, f: L.f, nameW: L.nameW });
        document.body.appendChild(node);
        try {
            const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
            blobs.push(await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('Could not create image')), 'image/png')));
        } finally {
            node.remove();
        }
    }
    return blobs;
}

function theftFileName(i, n) {
    return `DAE_DT_Misuse_${theftWord()}Wise_${getTheftMetric() === 'cases' ? 'Cases' : 'kW'}_${getDateSuffix()}${n > 1 ? `_part${i + 1}` : ''}.png`;
}

function downloadTheftImages(btn) {
    return runAction(btn, 'Preparing chart...', n => `${n} chart image${n > 1 ? 's' : ''} downloaded ✔ Ready for WhatsApp`, async () => {
        const blobs = await renderTheftBlobs();
        for (let i = 0; i < blobs.length; i++) {
            saveBlob(blobs[i], theftFileName(i, blobs.length));
            await new Promise(r => setTimeout(r, 500));
        }
        return blobs.length;
    });
}

function shareTheftWhatsApp(btn) {
    return runAction(btn, 'Preparing chart...', 'Share ready', async () => {
        const blobs = await renderTheftBlobs();
        const files = blobs.map((b, i) => new File([b], theftFileName(i, blobs.length), { type: 'image/png' }));
        const src = theftView === 'circle' ? theftData.circle_analysis : theftData.team_analysis;
        const lines = theftData.theft_types.map(t => {
            const c = src.reduce((a, r) => a + (r.by_type[t] ? r.by_type[t].cases : 0), 0);
            const k = src.reduce((a, r) => a + (r.by_type[t] ? r.by_type[t].kw : 0), 0);
            return `${t}: ${c} cases, ${k.toFixed(2)} kW`;
        }).join('\n');
        const text = `*${REPORT_ORG_NAME}*\n*DAE / DT / Misuse Analysis - ${theftWord()} Wise*\nPeriod: ${getRangeText()}\n${lines}`;

        if (navigator.canShare && navigator.canShare({ files })) {
            try {
                await navigator.share({ files, text, title: 'DAE DT Misuse Analysis' });
                return 'Shared';
            } catch (e) {
                if (e.name === 'AbortError') { showToast('Share cancelled', 'info'); return false; }
                throw e;
            }
        }
        for (let i = 0; i < blobs.length; i++) {
            saveBlob(blobs[i], files[i].name);
            await new Promise(r => setTimeout(r, 500));
        }
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
        showToast('Images saved. Attach them in the WhatsApp chat that opened.', 'success', 5000);
        return false;
    });
}

window.onload = () => {
    ensureUiStyles();
    resetFilters();
};