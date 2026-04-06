/* Wallets page */

async function loadWallets() {
    const wallets = await api('/api/wallets');
    const container = document.getElementById('walletsList');

    if (wallets.length === 0) {
        container.innerHTML = '<div class="tx-empty" style="grid-column:1/-1;padding:60px">No wallets yet. Tap + to add one.</div>';
        return;
    }

    container.innerHTML = wallets.map(w => `
        <div class="wallet-card" style="border-top: 4px solid ${w.color};cursor:pointer" onclick="window.location.href='/wallet/${w.id}'">
            <div class="wallet-top">
                <div>
                    <div class="wallet-icon">${w.icon}</div>
                    <div class="wallet-name">${escapeHtml(w.name)} <span class="tx-currency-badge">${w.currency}</span>${w.is_loan ? `<span class="loan-badge">🏦 Loan</span>` : ''}</div>
                    ${w.is_loan && w.loan_counterparty ? `<div style="font-size:.8rem;color:var(--text-secondary);margin-top:2px">🏦 ${escapeHtml(w.loan_counterparty)}</div>` : ''}
                    <div class="wallet-balance" style="color:${w.balance >= 0 ? 'var(--income)' : 'var(--expense)'}">${fmt(w.balance, w.symbol)}</div>
                </div>
            </div>
            <div class="wallet-actions">
                <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();editWallet(${w.id})">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteWallet(${w.id})">Delete</button>
            </div>
        </div>
    `).join('');
}

function openAddWallet() {
    document.getElementById('editWalletId').value = '';
    document.getElementById('walletModalTitle').textContent = 'Add Wallet';
    document.getElementById('walletName').value = '';
    document.getElementById('walletBalance').value = '';
    document.getElementById('walletIsLoan').checked = false;
    document.getElementById('walletLoanOutstanding').value = '';
    document.getElementById('walletLoanRoi').value = '';
    document.getElementById('walletLoanTenure').value = '';
    document.getElementById('walletLoanCounterparty').value = '';
    document.getElementById('walletLoanNote').value = '';
    toggleLoanFields(false);
    openModal('addWalletModal');
}

async function editWallet(id) {
    const wallets = await api('/api/wallets');
    const w = wallets.find(x => x.id === id);
    if (!w) return;
    document.getElementById('editWalletId').value = w.id;
    document.getElementById('walletModalTitle').textContent = 'Edit Wallet';
    document.getElementById('walletName').value = w.name;
    document.getElementById('walletBalance').value = w.balance;
    document.getElementById('walletCurrency').value = w.currency || 'EUR';
    document.getElementById('walletIsLoan').checked = !!w.is_loan;
    document.getElementById('walletLoanOutstanding').value = w.loan_outstanding || '';
    document.getElementById('walletLoanRoi').value = w.loan_roi || '';
    document.getElementById('walletLoanTenure').value = w.loan_tenure || '';
    document.getElementById('walletLoanCounterparty').value = w.loan_counterparty || '';
    document.getElementById('walletLoanNote').value = w.loan_note || '';
    toggleLoanFields(!!w.is_loan);
    openModal('addWalletModal');
}

async function saveWallet() {
    const editId = document.getElementById('editWalletId').value;
    const name = document.getElementById('walletName').value.trim();
    if (!name) { showToast('Enter wallet name'); return; }

    const selectedIcon = document.querySelector('#walletIconSelector .icon-option.selected');
    const selectedColor = document.querySelector('#walletColorSelector .color-option.selected');

    const isLoan = document.getElementById('walletIsLoan').checked;
    const loanOutstanding = parseFloat(document.getElementById('walletLoanOutstanding').value) || 0;

    const payload = {
        name,
        balance: isLoan ? loanOutstanding : (parseFloat(document.getElementById('walletBalance').value) || 0),
        currency: document.getElementById('walletCurrency').value || 'EUR',
        icon: selectedIcon ? selectedIcon.dataset.icon : '💳',
        color: selectedColor ? selectedColor.dataset.color : '#4CAF50',
        is_loan: isLoan,
        loan_outstanding: isLoan ? loanOutstanding : null,
        loan_roi: isLoan ? (parseFloat(document.getElementById('walletLoanRoi').value) || null) : null,
        loan_tenure: isLoan ? (parseInt(document.getElementById('walletLoanTenure').value) || null) : null,
        loan_counterparty: document.getElementById('walletLoanCounterparty').value.trim(),
        loan_note: document.getElementById('walletLoanNote').value.trim(),
    };

    if (editId) {
        await api(`/api/wallets/${editId}`, 'PUT', payload);
    } else {
        await api('/api/wallets', 'POST', payload);
    }
    closeModal('addWalletModal');
    showToast(editId ? 'Wallet updated' : 'Wallet added');
    loadWallets();
}

async function deleteWallet(id) {
    if (!confirm('Delete this wallet and all its transactions?')) return;
    await api(`/api/wallets/${id}`, 'DELETE');
    showToast('Wallet deleted');
    loadWallets();
}

function toggleLoanFields(show) {
    document.getElementById('loanFields').style.display = show ? 'block' : 'none';
    document.getElementById('walletBalanceGroup').style.display = show ? 'none' : 'block';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Icon & color selector handlers
document.querySelectorAll('#walletIconSelector .icon-option').forEach(el => {
    el.addEventListener('click', () => {
        document.querySelectorAll('#walletIconSelector .icon-option').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
    });
});
document.querySelectorAll('#walletColorSelector .color-option').forEach(el => {
    el.addEventListener('click', () => {
        document.querySelectorAll('#walletColorSelector .color-option').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
    });
});

function refreshPage() { loadWallets(); }
loadWallets();
