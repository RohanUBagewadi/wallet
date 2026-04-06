/* Transactions page */

async function loadFilterDropdowns() {
    const [cats, wallets] = await Promise.all([api('/api/categories'), api('/api/wallets')]);
    const wSel = document.getElementById('filterWallet');
    wSel.innerHTML = '<option value="">All Wallets</option>' + wallets.map(w => `<option value="${w.id}">${w.icon} ${w.name}</option>`).join('');
    const cSel = document.getElementById('filterCategory');
    cSel.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
}

async function loadTransactions() {
    const params = new URLSearchParams();
    const type = document.getElementById('filterType').value;
    const wallet = document.getElementById('filterWallet').value;
    const category = document.getElementById('filterCategory').value;
    const start = document.getElementById('filterStart').value;
    const end = document.getElementById('filterEnd').value;

    if (type && type !== 'transfer') params.set('type', type);
    if (wallet) params.set('wallet_id', wallet);
    if (category) params.set('category_id', category);
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
        return;
    }

    // Group by date
    let html = '';
    let lastDate = '';
    for (const item of all) {
        if (item.date !== lastDate) {
            lastDate = item.date;
            html += `<div class="date-group-header">${formatDate(item.date)}</div>`;
        }
        html += item.is_transfer ? renderTransferItem(item, true) : renderTxItem(item, true);
    }
    container.innerHTML = html;
}

function refreshPage() {
    loadTransactions();
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

// Init
loadFilterDropdowns();
loadTransactions();
