document.addEventListener("DOMContentLoaded", () => {
    const empIdInput = document.getElementById("empId");
    const empNameInput = document.getElementById("empName");
    const circleInput = document.getElementById("circle");
    const teamInput = document.getElementById("team");
    const lookupStatus = document.getElementById("lookupStatus");
    const dateInput = document.getElementById("inspectionDate");
    const form = document.getElementById("inspectionForm");
    const alertBox = document.getElementById("alertBox");

    // Default inspection date to today
    dateInput.value = new Date().toISOString().split("T")[0];

    let timer;
    empIdInput.addEventListener("input", () => {
        clearTimeout(timer);
        const query = empIdInput.value.trim();

        if (!query) {
            empNameInput.value = "";
            circleInput.value = "";
            teamInput.value = "";
            lookupStatus.textContent = "";
            return;
        }

        lookupStatus.textContent = "🔍";
        timer = setTimeout(async () => {
            try {
                const res = await fetch(`/api/employees/${encodeURIComponent(query)}`);
                if (res.ok) {
                    const data = await res.json();
                    empNameInput.value = data.name;
                    circleInput.value = data.circle;
                    teamInput.value = data.team;
                    lookupStatus.textContent = "✅";
                } else {
                    empNameInput.value = "";
                    circleInput.value = "";
                    teamInput.value = "";
                    lookupStatus.textContent = "❌ Not Found";
                }
            } catch {
                lookupStatus.textContent = "⚠️";
            }
        }, 300);
    });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        if (!empNameInput.value) {
            showAlert("Please enter a valid Employee ID.", "error");
            return;
        }

        const payload = {
            emp_id: empIdInput.value.trim(),
            inspection_date: dateInput.value,
            theft_type: document.querySelector('input[name="theftType"]:checked').value,
            load_book_no: document.getElementById("loadBookNo").value.trim(),
            page_no: document.getElementById("pageNo").value.trim(),
            assessed_load_kw: parseFloat(document.getElementById("assessedLoad").value)
        };

        const res = await fetch("/api/inspections", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (res.ok) {
            showAlert(data.message, "success");
            form.reset();
            dateInput.value = new Date().toISOString().split("T")[0];
            empNameInput.value = "";
            circleInput.value = "";
            teamInput.value = "";
            lookupStatus.textContent = "";
        } else {
            showAlert(data.detail || "Error saving entry", "error");
        }
    });

    function showAlert(msg, type) {
        alertBox.textContent = msg;
        alertBox.className = `alert ${type}`;
        alertBox.classList.remove("hidden");
        setTimeout(() => alertBox.classList.add("hidden"), 5000);
    }
});