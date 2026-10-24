document.addEventListener("DOMContentLoaded", () => {
    const fromInput = document.getElementById("filterFromDate");
    const toInput = document.getElementById("filterToDate");
    const filterBtn = document.getElementById("filterBtn");
    const resetBtn = document.getElementById("resetBtn");
    const mailBtn = document.getElementById("mailReportBtn");
    const alertBox = document.getElementById("summaryAlert");

    async function loadSummaries() {
        let url = "/api/summary";
        const params = new URLSearchParams();
        if (fromInput.value) params.append("from_date", fromInput.value);
        if (toInput.value) params.append("to_date", toInput.value);
        if (params.toString()) url += `?${params.toString()}`;

        const res = await fetch(url);
        if (!res.ok) return;
        const { circle_summary, name_summary } = await res.json();

        // Render Circle Summary
        const circleBody = document.querySelector("#circleTable tbody");
        circleBody.innerHTML = circle_summary.length
            ? circle_summary.map(c => `<tr><td>${c.circle}</td><td>${c.total_cases}</td><td>${c.total_load_kw.toFixed(2)} kW</td></tr>`).join("")
            : '<tr><td colspan="3">No records found</td></tr>';

        // Render Name-Wise Summary
        const nameBody = document.querySelector("#nameTable tbody");
        nameBody.innerHTML = name_summary.length
            ? name_summary.map(n => `
                <tr>
                    <td><strong>${n.emp_name}</strong></td>
                    <td>${n.emp_id}</td>
                    <td>${n.circle}</td>
                    <td>${n.total_cases}</td>
                    <td>${n.total_load_kw.toFixed(2)} kW</td>
                </tr>
            `).join("")
            : '<tr><td colspan="5">No records found</td></tr>';
    }

    filterBtn.addEventListener("click", loadSummaries);

    resetBtn.addEventListener("click", () => {
        fromInput.value = "";
        toInput.value = "";
        loadSummaries();
    });

    mailBtn.addEventListener("click", async () => {
        mailBtn.disabled = true;
        mailBtn.textContent = "Sending...";

        let url = "/api/summary/send-mail";
        const params = new URLSearchParams();
        if (fromInput.value) params.append("from_date", fromInput.value);
        if (toInput.value) params.append("to_date", toInput.value);
        if (params.toString()) url += `?${params.toString()}`;

        const res = await fetch(url, { method: "POST" });
        mailBtn.disabled = false;
        mailBtn.textContent = "✉️ Email This Summary to Management";

        if (res.ok) {
            showAlert("Summary report queued and sent to management.", "success");
        } else {
            showAlert("Failed to send email.", "error");
        }
    });

    function showAlert(msg, type) {
        alertBox.textContent = msg;
        alertBox.className = `alert ${type}`;
        alertBox.classList.remove("hidden");
        setTimeout(() => alertBox.classList.add("hidden"), 4000);
    }

    loadSummaries();
});