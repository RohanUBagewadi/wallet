/* Transactions page */

let selectMode = false;
let selectedIds = new Set();
let currentItems = []; // store last loaded items for re-render

async function loadFilterDropdowns() {
    const [cats, wallets, labels] = await Promise.all([api('/api/categories'), api('/api/wallets'), api('/api/labels')]);
    const wSel = document.getElementById('filterWallet');
    wSel.innerHTML = '<option value="">All Wallets</option>' + wallets.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
    const cSel = document.getElementById('filterCategory');
    cSel.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    const lSel = document.getElementById('filterLabel');
    lSel.innerHTML = '<option value="">All Labels</option>' + labels.map(l =>
        `<option value="${l.id}" style="color:${l.color}">${l.name}</option>`
    ).join('');
}

async function loadTransactions() {
    const params = new URLSearchParams();
    const type = document.getElementById('filterType').value;
    const wallet = document.getElementById('filterWallet').value;
    const category = document.getElementById('filterCategory').value;
    const label = document.getElementById('filterLabel').value;
    const start = document.getElementById('filterStart').value;
    const end = document.getElementById('filterEnd').value;

    if (type && type !== 'transfer') params.set('type', type);
    if (wallet) params.set('wallet_id', wallet);
    if (category) params.set('category_id', category);
    if (label) params.set('label_id', label);
    if (start) params.set('start', start);
    if (end) params.set('end', end);

    const showTransfers = !type || type === 'transfer';
    const showRegular = !type || type === 'income' || type === 'expense';

    const [txns, transfers] = await Promise.all([
        showRegular ? api('/api/transactions?' + params.toString()) : Promise.resolve([]),
        showTransfers ? api('/api/transfers') : Promise.resolve([]),
    ]);

    // Merge and sort by date desc, then id desc
    const all = [
        ...(txns || []),
        ...(transfers || []).filter(t => {
            if (start && t.date < start) return false;
            if (end && t.date > end) return false;
            if (wallet && t.from_wallet_id !== parseInt(wallet) && t.to_wallet_id !== parseInt(wallet)) return false;
            return true;
        }),
    ].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

    const container = document.getElementById('transactionsList');

    if (all.length === 0) {
        container.innerHTML = '<div class="tx-empty">No transactions found</div>';
        currentItems = [];
        return;
    }

    currentItems = all;
    renderTransactionList(all, container);
}

function renderTransactionList(items, container) {
    let html = '';
    let lastDate = '';
    for (const item of items) {
        if (item.date !== lastDate) {
            lastDate = item.date;
            html += `<div class="date-group-header">${formatDate(item.date)}</div>`;
        }
        if (selectMode && !item.is_transfer) {
            const checked = selectedIds.has(item.id) ? 'checked' : '';
            html += `<div class="tx-select-row">
                <input type="checkbox" class="tx-checkbox" data-id="${item.id}" ${checked} onchange="onTxCheckChange(this)">
                ${renderTxItem(item, false, false)}
            </div>`;
        } else {
            html += item.is_transfer ? renderTransferItem(item, true) : renderTxItem(item, true);
        }
    }
    container.innerHTML = html;
    updateSelectedCount();
}

function refreshPage() {
    loadTransactions();
    loadRecurring();
}

// --- Recurring Transactions ---
async function loadRecurring() {
    const container = document.getElementById('recurringList');
    if (!container) return;
    const recs = await api('/api/recurring');
    if (!recs || recs.length === 0) {
        container.innerHTML = '<div style="padding:12px;color:var(--text-secondary)">No recurring transactions set up.</div>';
        return;
    }
    container.innerHTML = recs.map(r => {
        const statusBadge = r.active
            ? '<span style="color:#4CAF50;font-size:.75rem">● Active</span>'
            : '<span style="color:#9E9E9E;font-size:.75rem">● Paused</span>';
        const color = r.type === 'income' ? 'var(--income)' : 'var(--expense)';
        const sign = r.type === 'income' ? '+' : '-';
        return `<div class="recurring-item" style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-bottom:1px solid var(--border)">
            <div style="flex:1">
                <div style="font-weight:600">${r.category_icon} ${r.category_name}</div>
                <div style="font-size:.8rem;color:var(--text-secondary)">${r.frequency_label} · ${r.wallet_name}${r.note ? ' · ' + r.note : ''}</div>
                <div style="font-size:.75rem;color:var(--text-secondary)">Next: ${r.next_date}${r.end_date ? ' · Ends: ' + r.end_date : ''}</div>
            </div>
            <div style="text-align:right">
                <div style="font-weight:600;color:${color}">${sign}${r.symbol}${r.amount.toLocaleString('en-US', {minimumFractionDigits:2})}</div>
                ${statusBadge}
            </div>
            <div style="display:flex;gap:4px">
                <button class="btn btn-outline btn-sm" onclick="toggleRecurring(${r.id})" title="${r.active ? 'Pause' : 'Resume'}">
                    <span class="mi" style="font-size:16px">${r.active ? 'pause' : 'play_arrow'}</span>
                </button>
                <button class="btn btn-outline btn-sm" onclick="deleteRecurring(${r.id})" title="Delete">
                    <span class="mi" style="font-size:16px">delete</span>
                </button>
            </div>
        </div>`;
    }).join('');
}

async function toggleRecurring(id) {
    await api(`/api/recurring/${id}/toggle`, 'POST');
    loadRecurring();
}

async function deleteRecurring(id) {
    if (!confirm('Delete this recurring transaction?')) return;
    await api(`/api/recurring/${id}`, 'DELETE');
    showToast('Recurring transaction deleted');
    loadRecurring();
}

// --- CSV Export ---
function exportCSV() {
    window.location.href = '/api/transactions/export';
}

// --- CSV Import ---
async function importCSV(input) {
    const file = input.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/transactions/import', { method: 'POST', body: formData });
    const data = await res.json();

    if (data.error) {
        showToast('Error: ' + data.error);
    } else {
        let msg = `Imported ${data.imported} transactions`;
        if (data.errors && data.errors.length > 0) {
            msg += `. ${data.errors.length} error(s)`;
            console.warn('Import errors:', data.errors);
        }
        showToast(msg);
        loadTransactions();
    }

    // Reset input so same file can be re-imported
    input.value = '';
}

// --- Selection Mode ---
function toggleSelectMode() {
    selectMode = !selectMode;
    selectedIds.clear();
    const bar = document.getElementById('selectionBar');
    const btn = document.getElementById('selectModeBtn');
    const selectAllCb = document.getElementById('selectAllCb');

    if (selectMode) {
        bar.style.display = 'flex';
        btn.textContent = '✕ Cancel';
        btn.classList.add('active');
    } else {
        bar.style.display = 'none';
        btn.innerHTML = '<span class="mi">checklist</span> Select';
        btn.classList.remove('active');
        selectAllCb.checked = false;
    }

    // Re-render list with/without checkboxes
    const container = document.getElementById('transactionsList');
    if (currentItems.length) renderTransactionList(currentItems, container);
}

function onTxCheckChange(cb) {
    const id = parseInt(cb.dataset.id);
    if (cb.checked) {
        selectedIds.add(id);
    } else {
        selectedIds.delete(id);
    }
    updateSelectedCount();
}

function toggleSelectAll() {
    const checked = document.getElementById('selectAllCb').checked;
    if (checked) {
        currentItems.forEach(item => { if (!item.is_transfer) selectedIds.add(item.id); });
    } else {
        selectedIds.clear();
    }
    // Update all checkboxes
    document.querySelectorAll('.tx-checkbox').forEach(cb => { cb.checked = checked; });
    updateSelectedCount();
}

function updateSelectedCount() {
    const el = document.getElementById('selectedCount');
    if (el) el.textContent = `${selectedIds.size} selected`;
}

async function deleteSelected() {
    if (selectedIds.size === 0) {
        showToast('No transactions selected', 'error');
        return;
    }
    if (!confirm(`Delete ${selectedIds.size} transaction(s)? This cannot be undone.`)) return;

    try {
        const res = await fetch('/api/transactions/bulk-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: Array.from(selectedIds) }),
        });
        const data = await res.json();
        if (data.error) {
            showToast('Error: ' + data.error, 'error');
        } else {
            showToast(`Deleted ${data.deleted} transaction(s)`);
            selectedIds.clear();
            loadTransactions();
        }
    } catch (e) {
        showToast('Network error', 'error');
    }
}

// Init
loadFilterDropdowns();
loadTransactions();
loadRecurring();
