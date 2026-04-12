/* ============ Shared utilities ============ */

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

// Close sidebar on outside click (mobile)
document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.classList.contains('open') && !sidebar.contains(e.target) && !e.target.classList.contains('menu-toggle')) {
        sidebar.classList.remove('open');
    }
});

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function openAddModal() {
    document.getElementById('editTxId').value = '';
    document.getElementById('txModalTitle').textContent = 'Add Transaction';
    document.getElementById('txAmount').value = '';
    document.getElementById('txFromAmount').value = '';
    document.getElementById('txNote').value = '';
    document.getElementById('txDate').value = new Date().toISOString().split('T')[0];
    window._selectedLabelIds = [];
    setTxType('expense');
    loadModalDropdowns();
    openModal('addTransactionModal');
}

function setTxType(type) {
    document.querySelectorAll('.tx-type-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.type === type);
    });
    const isTransfer = type === 'transfer';
    const isEmi = type === 'emi';
    const isRegular = !isTransfer && !isEmi;
    document.getElementById('txRegularFields').style.display = isRegular ? 'block' : 'none';
    document.getElementById('txTransferFields').style.display = isTransfer ? 'block' : 'none';
    document.getElementById('txEmiFields').style.display = isEmi ? 'block' : 'none';
    // Filter categories by type (only for regular)
    if (isRegular) {
        const sel = document.getElementById('txCategory');
        if (sel && window._allCategories) {
            const filtered = window._allCategories.filter(c => c.type === type);
            sel.innerHTML = filtered.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
        }
    }
}

function getCurrentTxType() {
    const active = document.querySelector('.tx-type-btn.active');
    return active ? active.dataset.type : 'expense';
}

async function loadModalDropdowns() {
    const [cats, wallets, labels] = await Promise.all([
        api('/api/categories'), api('/api/wallets'), api('/api/labels')
    ]);
    window._allCategories = cats;
    window._allWallets = wallets;
    setTxType(getCurrentTxType());

    const walletOpts = wallets.map(w =>
        `<option value="${w.id}" data-currency="${w.currency}" data-symbol="${w.symbol}">${w.icon} ${w.name} (${w.currency})</option>`
    ).join('');

    const wSel = document.getElementById('txWallet');
    if (wSel) { wSel.innerHTML = walletOpts; updateExchangeRateVisibility(); }

    const fromSel = document.getElementById('txFromWallet');
    const toSel = document.getElementById('txToWallet');
    if (fromSel) { fromSel.innerHTML = walletOpts; }
    if (toSel) { toSel.innerHTML = walletOpts; }
    updateTransferRate();

    // EMI dropdowns: from = normal wallets, loan = loan wallets
    const normalOpts = wallets.filter(w => !w.is_loan).map(w =>
        `<option value="${w.id}">${w.icon} ${w.name} (${w.currency})</option>`).join('');
    const loanOpts = wallets.filter(w => w.is_loan).map(w =>
        `<option value="${w.id}">${w.icon} ${w.name} (${w.currency})</option>`).join('');
    const emiFromSel = document.getElementById('txEmiFromWallet');
    const emiLoanSel = document.getElementById('txEmiLoanWallet');
    if (emiFromSel) emiFromSel.innerHTML = normalOpts || walletOpts;
    if (emiLoanSel) emiLoanSel.innerHTML = loanOpts || '<option value="">No loan accounts</option>';

    // Render label chips
    renderLabelChips(labels, window._selectedLabelIds || []);
}

function updateExchangeRateVisibility() {
    const wSel = document.getElementById('txWallet');
    const rateGroup = document.getElementById('exchangeRateGroup');
    if (!wSel || !rateGroup) return;
    const opt = wSel.options[wSel.selectedIndex];
    const currency = opt ? opt.dataset.currency : 'EUR';
    if (currency === 'EUR') {
        rateGroup.style.display = 'none';
        document.getElementById('txExchangeRate').value = '1';
    } else {
        rateGroup.style.display = 'block';
        document.getElementById('exchangeRateLabel').textContent = `Exchange Rate (1 ${currency} = ? EUR)`;
    }
}

async function saveTransaction() {
    const editId = document.getElementById('editTxId').value;
    const txType = getCurrentTxType();

    if (txType === 'transfer') {
        const fromWalletId = parseInt(document.getElementById('txFromWallet').value);
        const toWalletId = parseInt(document.getElementById('txToWallet').value);
        const fromAmount = parseFloat(document.getElementById('txFromAmount').value);
        const transferRate = parseFloat(document.getElementById('txTransferRate').value) || 1.0;
        if (!fromAmount || fromAmount <= 0) { showToast('Enter a valid amount'); return; }
        if (fromWalletId === toWalletId) { showToast('From and To wallet must be different'); return; }
        const payload = {
            from_wallet_id: fromWalletId,
            to_wallet_id: toWalletId,
            from_amount: fromAmount,
            exchange_rate: transferRate,
            date: document.getElementById('txDate').value,
            note: document.getElementById('txNote').value,
        };
        await api('/api/transfers', 'POST', payload);
        closeModal('addTransactionModal');
        showToast('Transfer saved');
        if (typeof refreshPage === 'function') refreshPage();
        return;
    }

    if (txType === 'emi') {
        const fromWalletId = parseInt(document.getElementById('txEmiFromWallet').value);
        const loanWalletId = parseInt(document.getElementById('txEmiLoanWallet').value);
        const amount = parseFloat(document.getElementById('txEmiAmount').value);
        if (!amount || amount <= 0) { showToast('Enter a valid EMI amount'); return; }
        if (!loanWalletId) { showToast('Select a loan account'); return; }
        const payload = {
            from_wallet_id: fromWalletId,
            to_wallet_id: loanWalletId,
            from_amount: amount,
            exchange_rate: 1.0,
            date: document.getElementById('txDate').value,
            note: document.getElementById('txNote').value || 'EMI Payment',
        };
        await api('/api/transfers', 'POST', payload);
        closeModal('addTransactionModal');
        showToast('EMI payment recorded');
        if (typeof refreshPage === 'function') refreshPage();
        return;
    }

    const payload = {
        amount: parseFloat(document.getElementById('txAmount').value),
        type: txType,
        category_id: parseInt(document.getElementById('txCategory').value),
        wallet_id: parseInt(document.getElementById('txWallet').value),
        date: document.getElementById('txDate').value,
        note: document.getElementById('txNote').value,
        exchange_rate: parseFloat(document.getElementById('txExchangeRate').value) || 1.0,
        label_ids: window._selectedLabelIds || [],
    };

    if (!payload.amount || payload.amount <= 0) { showToast('Enter a valid amount'); return; }

    if (editId) {
        await api(`/api/transactions/${editId}`, 'PUT', payload);
    } else {
        await api('/api/transactions', 'POST', payload);
    }
    closeModal('addTransactionModal');
    showToast(editId ? 'Transaction updated' : 'Transaction added');
    if (typeof refreshPage === 'function') refreshPage();
}

async function deleteTransaction(id) {
    if (!confirm('Delete this transaction?')) return;
    await api(`/api/transactions/${id}`, 'DELETE');
    showToast('Transaction deleted');
    if (typeof refreshPage === 'function') refreshPage();
}

async function editTransaction(id) {
    const txns = await api('/api/transactions');
    const tx = txns.find(t => t.id === id);
    if (!tx) return;
    window._selectedLabelIds = (tx.labels || []).map(l => l.id);
    await loadModalDropdowns();
    document.getElementById('editTxId').value = tx.id;
    document.getElementById('txModalTitle').textContent = 'Edit Transaction';
    document.getElementById('txAmount').value = tx.amount;
    document.getElementById('txNote').value = tx.note;
    document.getElementById('txDate').value = tx.date;
    document.getElementById('txExchangeRate').value = tx.exchange_rate;
    setTxType(tx.type);
    document.getElementById('txCategory').value = tx.category_id;
    document.getElementById('txWallet').value = tx.wallet_id;
    updateExchangeRateVisibility();
    renderLabelChips(window._allLabels || [], window._selectedLabelIds);
    openModal('addTransactionModal');
}

// Transfer helpers
function updateTransferRate() {
    const fromSel = document.getElementById('txFromWallet');
    const toSel = document.getElementById('txToWallet');
    const rateGroup = document.getElementById('transferRateGroup');
    const preview = document.getElementById('toAmountPreview');
    if (!fromSel || !toSel || !rateGroup) return;
    const fromOpt = fromSel.options[fromSel.selectedIndex];
    const toOpt = toSel.options[toSel.selectedIndex];
    const fromCurr = fromOpt ? fromOpt.dataset.currency : 'EUR';
    const toCurr = toOpt ? toOpt.dataset.currency : 'EUR';
    if (fromCurr === toCurr) {
        rateGroup.style.display = 'none';
        document.getElementById('txTransferRate').value = '1';
        preview.style.display = 'none';
    } else {
        rateGroup.style.display = 'block';
        document.getElementById('transferRateLabel').textContent = `Exchange Rate (1 ${fromCurr} = ? ${toCurr})`;
        preview.style.display = 'block';
    }
    updateToAmount();
}

function updateToAmount() {
    const fromSel = document.getElementById('txFromWallet');
    const toSel = document.getElementById('txToWallet');
    const fromAmount = parseFloat(document.getElementById('txFromAmount').value) || 0;
    const rate = parseFloat(document.getElementById('txTransferRate').value) || 1;
    const toOpt = toSel ? toSel.options[toSel.selectedIndex] : null;
    const toSym = toOpt ? toOpt.dataset.symbol : '€';
    const toAmount = fromAmount * rate;
    const el = document.getElementById('toAmountValue');
    if (el) el.textContent = toAmount > 0 ? `${toSym}${toAmount.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 4})}` : '-';
}

// Label helpers
function renderLabelChips(labels, selectedIds) {
    window._allLabels = labels;
    const container = document.getElementById('labelsContainer');
    if (!container) return;
    if (labels.length === 0) {
        container.innerHTML = '<span style="color:var(--text-secondary);font-size:.8rem">No labels yet. Click + New Label to create one.</span>';
        return;
    }
    container.innerHTML = labels.map(l => {
        const sel = selectedIds.includes(l.id);
        return `<span class="label-chip${sel ? ' selected' : ''}" style="background:${l.color}22;color:${l.color}" onclick="toggleLabel(${l.id})">${l.name}</span>`;
    }).join('');
}

function toggleLabel(id) {
    if (!window._selectedLabelIds) window._selectedLabelIds = [];
    const idx = window._selectedLabelIds.indexOf(id);
    if (idx === -1) window._selectedLabelIds.push(id);
    else window._selectedLabelIds.splice(idx, 1);
    renderLabelChips(window._allLabels || [], window._selectedLabelIds);
}

function showNewLabelInput() {
    document.getElementById('newLabelRow').style.display = 'flex';
    document.getElementById('newLabelName').focus();
}

function hideNewLabelInput() {
    document.getElementById('newLabelRow').style.display = 'none';
    document.getElementById('newLabelName').value = '';
}

async function createLabel() {
    const name = document.getElementById('newLabelName').value.trim();
    const color = document.getElementById('newLabelColor').value;
    if (!name) { showToast('Enter a label name'); return; }
    const label = await api('/api/labels', 'POST', { name, color });
    if (label.error) { showToast(label.error); return; }
    if (!window._allLabels) window._allLabels = [];
    window._allLabels.push(label);
    hideNewLabelInput();
    renderLabelChips(window._allLabels, window._selectedLabelIds || []);
}

async function deleteTransfer(id) {
    if (!confirm('Delete this transfer?')) return;
    await api(`/api/transfers/${id}`, 'DELETE');
    showToast('Transfer deleted');
    if (typeof refreshPage === 'function') refreshPage();
}

// Render a transfer item
function renderTransferItem(tr, showActions = false) {
    return `
    <div class="tx-item${showActions ? '' : ' no-actions'}" ondblclick="deleteTransfer(${tr.id})">
        <div class="tx-icon" style="background:rgba(66,165,245,.12);color:#42A5F5"><span class="mi">swap_horiz</span></div>
        <div class="tx-col tx-col-wallet">${tr.from_wallet_name}</div>
        <div class="tx-col tx-col-cat">Transfer</div>
        <div class="tx-col tx-col-label">---</div>
        <div class="tx-col tx-col-note">${tr.note || '---'}</div>
        <div class="tx-col tx-col-amount transfer">-${fmt(tr.from_amount, tr.from_symbol)}</div>
        <div class="tx-col tx-col-currency">${tr.from_currency}</div>
        ${showActions ? `
        <button class="tx-action-btn" onclick="event.stopPropagation();deleteTransfer(${tr.id})" title="Edit"><span class="mi">edit</span></button>
        <button class="tx-action-btn" onclick="event.stopPropagation();deleteTransfer(${tr.id})" title="Delete"><span class="mi">delete</span></button>
        ` : ''}
    </div>`;
}

// API helper
async function api(url, method = 'GET', body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (res.status === 401) { window.location.href = '/login'; return; }
    return res.json();
}

// Format currency — pass symbol for wallet-specific, default to EUR
function fmt(amount, symbol = '€') {
    return symbol + Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function fmtEur(amount) { return fmt(amount, '€'); }

// Toast notification
function showToast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
}

// Render a single transaction item HTML
function renderTxItem(tx, showActions = false, editable = true) {
    const sym = tx.symbol || '€';
    const eurNote = tx.currency !== 'EUR' ? ` <span class="tx-eur">(€${Math.abs(tx.amount_eur).toFixed(2)})</span>` : '';
    const labelsHtml = (tx.labels && tx.labels.length)
        ? tx.labels.map(l => `<span class="label-chip" style="background:${l.color}22;color:${l.color}">${l.name}</span>`).join(' ')
        : '---';
    const dblClickAttr = editable ? `ondblclick="editTransaction(${tx.id})"` : '';
    return `
    <div class="tx-item${showActions ? '' : ' no-actions'}" ${dblClickAttr}>
        <div class="tx-icon" style="background:${tx.category_color}22; color:${tx.category_color}">
            ${tx.category_icon}
        </div>
        <div class="tx-col tx-col-wallet">${tx.wallet_name}</div>
        <div class="tx-col tx-col-cat">${tx.category_name}</div>
        <div class="tx-col tx-col-label">${labelsHtml}</div>
        <div class="tx-col tx-col-note">${tx.note || '---'}</div>
        <div class="tx-col tx-col-amount ${tx.type}">${tx.type === 'income' ? '+' : '-'}${fmt(tx.amount, sym)}${eurNote}</div>
        <div class="tx-col tx-col-currency">${tx.currency}</div>
        ${showActions ? `
        <button class="tx-action-btn" onclick="event.stopPropagation();editTransaction(${tx.id})" title="Edit"><span class="mi">edit</span></button>
        <button class="tx-action-btn" onclick="event.stopPropagation();deleteTransaction(${tx.id})" title="Delete"><span class="mi">delete</span></button>
        ` : ''}
    </div>`;
}

function formatDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    const today = new Date();
    today.setHours(0,0,0,0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    if (d.getTime() === today.getTime()) return 'Today';
    if (d.getTime() === yesterday.getTime()) return 'Yesterday';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// Register service worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/sw.js').catch(() => {});
}

// ---- Wallet Transactions Drawer ----
async function openWalletTransactions(walletId, walletName, subtitle) {
    const modal = document.getElementById('walletTxModal');
    if (!modal) return;
    document.getElementById('walletTxModalTitle').textContent = walletName;
    document.getElementById('walletTxModalSubtitle').textContent = subtitle || '';
    document.getElementById('walletTxList').innerHTML = '<div class="tx-empty">Loading…</div>';
    openModal('walletTxModal');

    const [txns, transfers] = await Promise.all([
        api(`/api/transactions?wallet_id=${walletId}`),
        api('/api/transfers'),
    ]);

    const walletTransfers = (transfers || []).filter(t =>
        t.from_wallet_id === walletId || t.to_wallet_id === walletId
    );

    const all = [
        ...(txns || []),
        ...walletTransfers,
    ].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

    if (all.length === 0) {
        document.getElementById('walletTxList').innerHTML = '<div class="tx-empty">No transactions yet</div>';
        return;
    }

    let html = '';
    let lastDate = '';
    for (const item of all) {
        if (item.date !== lastDate) {
            lastDate = item.date;
            html += `<div class="date-group-header">${formatDate(item.date)}</div>`;
        }
        html += item.is_transfer ? renderTransferItem(item, false) : renderTxItem(item, false);
    }
    document.getElementById('walletTxList').innerHTML = html;
}
