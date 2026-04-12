/* ── Import Page ── */
let csvHeaders = [];
let csvRows = [];
let csvFile = null;

document.addEventListener("DOMContentLoaded", () => {
    const fileInput = document.getElementById("csvFile");
    const dropzone = document.getElementById("dropzone");

    fileInput.addEventListener("change", (e) => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });

    dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzone.classList.add("drag-over");
    });
    dropzone.addEventListener("dragleave", () => {
        dropzone.classList.remove("drag-over");
    });
    dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.classList.remove("drag-over");
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });

    // Update date preview when format changes
    document.getElementById("dateFormat").addEventListener("change", updateDatePreview);

    // Update sample values when mapping changes
    document.querySelectorAll(".col-select").forEach(sel => {
        sel.addEventListener("change", () => updateSampleValues(sel));
    });

    loadWallets();
});

async function loadWallets() {
    try {
        const wallets = await api("/api/wallets");
        const sel = document.getElementById("defaultWallet");
        sel.innerHTML = "";
        wallets.forEach(w => {
            const opt = document.createElement("option");
            opt.value = w.id;
            opt.textContent = `${w.name} (${w.currency})`;
            sel.appendChild(opt);
        });
    } catch (e) {
        console.error("Failed to load wallets", e);
    }
}

function handleFile(file) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
        showToast("Please select a .csv file", "error");
        return;
    }

    csvFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        parseCSV(text);
        showStep2();
    };
    reader.readAsText(file);
}

function parseCSV(text) {
    // Handle BOM
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    const lines = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') {
            if (inQuotes && i + 1 < text.length && text[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
            if (current.length || lines.length) {
                lines.push(current);
                current = "";
            }
            if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') i++;
        } else {
            current += ch;
        }
    }
    if (current.length) lines.push(current);

    if (lines.length === 0) {
        showToast("CSV file appears to be empty", "error");
        return;
    }

    csvHeaders = splitCSVLine(lines[0]);
    csvRows = [];
    for (let i = 1; i < lines.length && i <= 100; i++) {
        const cols = splitCSVLine(lines[i]);
        if (cols.length) csvRows.push(cols);
    }

    populateMappingSelects();
    renderPreviewTable();
    autoDetectMappings();
    updateDatePreview();
}

function splitCSVLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            result.push(current.trim());
            current = "";
        } else {
            current += ch;
        }
    }
    result.push(current.trim());
    return result;
}

function populateMappingSelects() {
    document.querySelectorAll(".col-select").forEach(sel => {
        sel.innerHTML = '<option value="">— skip —</option>';
        csvHeaders.forEach((h, idx) => {
            const opt = document.createElement("option");
            opt.value = h;
            opt.textContent = h;
            sel.appendChild(opt);
        });
    });
}

function autoDetectMappings() {
    const guesses = {
        col_date: ["date", "transaction date", "txn date", "value date", "posting date", "trans date"],
        col_amount: ["amount", "debit amount", "credit amount", "transaction amount", "sum", "value"],
        col_type: ["type", "transaction type", "txn type", "dr/cr", "debit/credit"],
        col_category: ["category", "group", "tag"],
        col_wallet: ["wallet", "account", "bank", "account name"],
        col_currency: ["currency", "ccy", "cur", "amount currency", "transaction currency"],
        col_note: ["note", "description", "narration", "details", "particulars", "remarks", "memo", "reference"],
        col_exchange_rate: ["exchange rate", "rate", "fx rate"],
        col_amount_eur: ["amount (eur)", "amount eur", "eur amount", "amount_eur"],
        col_labels: ["labels", "label", "tags", "tag"],
    };

    const headersLower = csvHeaders.map(h => h.toLowerCase().trim());

    Object.entries(guesses).forEach(([field, keywords]) => {
        const sel = document.querySelector(`.col-select[data-field="${field}"]`);
        if (!sel) return;

        // Exact match first, then partial
        let matchIdx = -1;
        for (const kw of keywords) {
            matchIdx = headersLower.indexOf(kw);
            if (matchIdx >= 0) break;
        }
        if (matchIdx < 0) {
            for (const kw of keywords) {
                matchIdx = headersLower.findIndex(h => h.includes(kw) || kw.includes(h));
                if (matchIdx >= 0) break;
            }
        }
        if (matchIdx >= 0) {
            sel.value = csvHeaders[matchIdx];
            updateSampleValues(sel);
        }
    });

    // Auto-detect date format from first sample
    autoDetectDateFormat();
}

function autoDetectDateFormat() {
    const dateSel = document.querySelector('.col-select[data-field="col_date"]');
    if (!dateSel || !dateSel.value) return;
    const colIdx = csvHeaders.indexOf(dateSel.value);
    if (colIdx < 0 || csvRows.length === 0) return;

    let sample = csvRows[0][colIdx];
    if (!sample) return;
    // Strip ISO 8601 time portion
    if (sample.includes('T')) sample = sample.split('T')[0];

    const formatSel = document.getElementById("dateFormat");
    const formats = Array.from(formatSel.options).map(o => o.value);

    // Try each format with a simple heuristic
    if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(sample)) {
        formatSel.value = sample.includes("/") ? "%Y/%m/%d" : "%Y-%m-%d";
    } else if (/^\d{2}\/\d{2}\/\d{4}/.test(sample)) {
        // Could be DD/MM or MM/DD — check if first part > 12 → DD/MM
        const parts = sample.split("/");
        formatSel.value = parseInt(parts[0]) > 12 ? "%d/%m/%Y" : "%m/%d/%Y";
    } else if (/^\d{2}-\d{2}-\d{4}/.test(sample)) {
        const parts = sample.split("-");
        formatSel.value = parseInt(parts[0]) > 12 ? "%d-%m-%Y" : "%m-%d-%Y";
    } else if (/^\d{2}\.\d{2}\.\d{4}/.test(sample)) {
        formatSel.value = "%d.%m.%Y";
    } else if (/^[A-Za-z]{3}\s+\d{1,2},?\s+\d{4}/.test(sample)) {
        formatSel.value = "%b %d, %Y";
    } else if (/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/.test(sample)) {
        formatSel.value = "%d %b %Y";
    }
    updateDatePreview();
}

function updateSampleValues(sel) {
    const field = sel.dataset.field;
    const sampleSpan = document.querySelector(`.sample-values[data-field="${field}"]`);
    if (!sampleSpan) return;

    if (!sel.value) {
        sampleSpan.textContent = "";
        return;
    }

    const colIdx = csvHeaders.indexOf(sel.value);
    if (colIdx < 0) {
        sampleSpan.textContent = "";
        return;
    }

    const samples = csvRows.slice(0, 3).map(r => r[colIdx] || "").filter(Boolean);
    sampleSpan.textContent = samples.join(" | ");

    // If date column changed, re-detect format
    if (field === "col_date") autoDetectDateFormat();
}

function updateDatePreview() {
    const badge = document.getElementById("datePreviewBadge");
    const dateSel = document.querySelector('.col-select[data-field="col_date"]');
    if (!dateSel || !dateSel.value) {
        badge.textContent = "";
        return;
    }
    const colIdx = csvHeaders.indexOf(dateSel.value);
    if (colIdx < 0 || csvRows.length === 0) {
        badge.textContent = "";
        return;
    }
    const sample = csvRows[0][colIdx];
    const fmt = document.getElementById("dateFormat").value;
    // Show what the sample would parse to
    const parsed = parseDateWithFormat(sample, fmt);
    if (parsed) {
        badge.textContent = `"${sample}" → ${parsed.toISOString().slice(0, 10)}`;
        badge.className = "import-date-preview valid";
    } else {
        badge.textContent = `"${sample}" → ❌ cannot parse`;
        badge.className = "import-date-preview invalid";
    }
}

function parseDateWithFormat(str, fmt) {
    if (!str) return null;
    str = str.trim();
    // Strip ISO 8601 time portion (e.g. 2024-02-26T11:00:51+00:00 → 2024-02-26)
    if (str.includes('T')) str = str.split('T')[0];

    const monthNames = {
        jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
        jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
        january: 0, february: 1, march: 2, april: 3, june: 5,
        july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    };

    let y, m, d;

    try {
        if (fmt === "%Y-%m-%d") {
            [y, m, d] = str.split("-").map(Number);
        } else if (fmt === "%d/%m/%Y") {
            [d, m, y] = str.split("/").map(Number);
        } else if (fmt === "%m/%d/%Y") {
            [m, d, y] = str.split("/").map(Number);
        } else if (fmt === "%d-%m-%Y") {
            [d, m, y] = str.split("-").map(Number);
        } else if (fmt === "%m-%d-%Y") {
            [m, d, y] = str.split("-").map(Number);
        } else if (fmt === "%d.%m.%Y") {
            [d, m, y] = str.split(".").map(Number);
        } else if (fmt === "%Y/%m/%d") {
            [y, m, d] = str.split("/").map(Number);
        } else if (fmt === "%b %d, %Y") {
            const match = str.match(/^([A-Za-z]+)\s+(\d+),?\s+(\d+)/);
            if (!match) return null;
            m = (monthNames[match[1].toLowerCase()] ?? -1) + 1;
            d = parseInt(match[2]);
            y = parseInt(match[3]);
        } else if (fmt === "%d %b %Y") {
            const match = str.match(/^(\d+)\s+([A-Za-z]+)\s+(\d+)/);
            if (!match) return null;
            d = parseInt(match[1]);
            m = (monthNames[match[2].toLowerCase()] ?? -1) + 1;
            y = parseInt(match[3]);
        } else if (fmt === "%d %B %Y") {
            const match = str.match(/^(\d+)\s+([A-Za-z]+)\s+(\d+)/);
            if (!match) return null;
            d = parseInt(match[1]);
            m = (monthNames[match[2].toLowerCase()] ?? -1) + 1;
            y = parseInt(match[3]);
        } else {
            return null;
        }

        if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
        const dt = new Date(y, m - 1, d);
        if (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) return dt;
        return null;
    } catch {
        return null;
    }
}

function renderPreviewTable() {
    const table = document.getElementById("previewTable");
    const previewRows = csvRows.slice(0, 5);

    let html = "<thead><tr>";
    csvHeaders.forEach(h => { html += `<th>${escapeHtml(h)}</th>`; });
    html += "</tr></thead><tbody>";

    previewRows.forEach(row => {
        html += "<tr>";
        csvHeaders.forEach((_, i) => {
            html += `<td>${escapeHtml(row[i] || "")}</td>`;
        });
        html += "</tr>";
    });
    html += "</tbody>";
    table.innerHTML = html;
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function showStep2() {
    document.getElementById("importStep1").style.display = "none";
    document.getElementById("importStep2").style.display = "block";
    document.getElementById("importStep3").style.display = "none";
    // Update step indicator
    document.getElementById("stepDot1").className = "step-dot done";
    document.getElementById("stepLine1").className = "step-line done";
    document.getElementById("stepDot2").className = "step-dot active";
    document.getElementById("stepDot3").className = "step-dot";
    document.getElementById("stepLine2").className = "step-line";
    // Show file info
    if (csvFile) {
        document.getElementById("fileName").textContent = csvFile.name;
        const size = csvFile.size < 1024 ? csvFile.size + ' B' : (csvFile.size / 1024).toFixed(1) + ' KB';
        document.getElementById("fileMeta").textContent = `${size} · ${csvRows.length} rows · ${csvHeaders.length} columns`;
    }
}

function resetImport() {
    csvHeaders = [];
    csvRows = [];
    csvFile = null;
    document.getElementById("csvFile").value = "";
    document.getElementById("importStep1").style.display = "block";
    document.getElementById("importStep2").style.display = "none";
    document.getElementById("importStep3").style.display = "none";
    // Reset step indicator
    document.getElementById("stepDot1").className = "step-dot active";
    document.getElementById("stepLine1").className = "step-line";
    document.getElementById("stepDot2").className = "step-dot";
    document.getElementById("stepLine2").className = "step-line";
    document.getElementById("stepDot3").className = "step-dot";
}

async function executeImport() {
    const dateSel = document.querySelector('.col-select[data-field="col_date"]');
    const amountSel = document.querySelector('.col-select[data-field="col_amount"]');

    if (!dateSel.value) {
        showToast("Please map the Date column", "error");
        return;
    }
    if (!amountSel.value) {
        showToast("Please map the Amount column", "error");
        return;
    }
    if (!csvFile) {
        showToast("No file selected", "error");
        return;
    }

    const btn = document.getElementById("importBtn");
    btn.disabled = true;
    btn.textContent = "Importing...";

    const formData = new FormData();
    formData.append("file", csvFile);
    formData.append("date_format", document.getElementById("dateFormat").value);
    formData.append("default_type", document.getElementById("defaultType").value);
    formData.append("default_wallet_id", document.getElementById("defaultWallet").value);

    // Append column mappings
    document.querySelectorAll(".col-select").forEach(sel => {
        formData.append(sel.dataset.field, sel.value);
    });

    try {
        const resp = await fetch("/api/import/mapped", {
            method: "POST",
            body: formData,
        });
        const result = await resp.json();

        if (!resp.ok) {
            showToast(result.error || "Import failed", "error");
            btn.disabled = false;
            btn.textContent = "Import Transactions";
            return;
        }

        showStep3(result);
    } catch (e) {
        showToast("Network error: " + e.message, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Import Transactions";
    }
}

function showStep3(result) {
    document.getElementById("importStep1").style.display = "none";
    document.getElementById("importStep2").style.display = "none";
    document.getElementById("importStep3").style.display = "block";
    // Update step indicator
    document.getElementById("stepDot1").className = "step-dot done";
    document.getElementById("stepLine1").className = "step-line done";
    document.getElementById("stepDot2").className = "step-dot done";
    document.getElementById("stepLine2").className = "step-line done";
    document.getElementById("stepDot3").className = "step-dot active";

    const title = document.getElementById("resultTitle");
    const summary = document.getElementById("resultSummary");
    const errorsDiv = document.getElementById("resultErrors");
    const iconDiv = document.getElementById("resultIcon");

    if (result.imported > 0) {
        title.textContent = "Import Successful!";
        title.style.color = "#4CAF50";
        iconDiv.innerHTML = '<span class="mi" style="color:#4CAF50">check_circle</span>';
    } else {
        title.textContent = "Import Failed";
        title.style.color = "#F44336";
        iconDiv.innerHTML = '<span class="mi" style="color:#F44336">error</span>';
    }

    summary.textContent = `${result.imported} transaction${result.imported !== 1 ? "s" : ""} imported.`;

    if (result.errors && result.errors.length > 0) {
        errorsDiv.style.display = "block";
        errorsDiv.innerHTML = `<h4>Errors (${result.errors.length})</h4><ul>${
            result.errors.slice(0, 50).map(e => `<li>${escapeHtml(e)}</li>`).join("")
        }${result.errors.length > 50 ? `<li>...and ${result.errors.length - 50} more</li>` : ""}</ul>`;
    } else {
        errorsDiv.style.display = "none";
    }
}
