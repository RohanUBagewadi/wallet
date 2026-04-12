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
                    <div class="wallet-icon">${/^[a-z_]+$/.test(w.icon) ? `<span class="mi">${w.icon}</span>` : w.icon}</div>
                    <div class="wallet-name">${escapeHtml(w.name)} <span class="tx-currency-badge">${w.currency}</span>${w.is_loan ? `<span class="loan-badge"><span class="mi" style="font-size:14px">account_balance</span> Loan</span>` : ''}</div>
                    ${w.is_loan && w.loan_counterparty ? `<div style="font-size:.8rem;color:var(--text-secondary);margin-top:2px"><span class="mi" style="font-size:14px">account_balance</span> ${escapeHtml(w.loan_counterparty)}</div>` : ''}
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
    document.getElementById('walletLoanEmi').value = '';
    document.getElementById('loanCalcPreview').style.display = 'none';
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
    document.getElementById('walletLoanEmi').value = '';
    recalcLoanPreview();
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
    const loanTenure = parseInt(document.getElementById('walletLoanTenure').value) || null;

    let loanRoi = parseFloat(document.getElementById('walletLoanRoi').value) || null;
    const loanEmiInput = parseFloat(document.getElementById('walletLoanEmi').value) || null;

    // If EMI is provided but ROI is blank, back-calculate annual ROI using Newton-Raphson
    if (isLoan && loanEmiInput && loanOutstanding > 0 && loanTenure && !loanRoi) {
        const r = solveMonthlyRate(loanOutstanding, loanEmiInput, loanTenure);
        if (r !== null) loanRoi = Math.round(r * 12 * 100 * 1000) / 1000; // annual %, 3 decimal places
    }

    const payload = {
        name,
        balance: isLoan ? loanOutstanding : (parseFloat(document.getElementById('walletBalance').value) || 0),
        currency: document.getElementById('walletCurrency').value || 'EUR',
        icon: selectedIcon ? selectedIcon.dataset.icon : 'credit_card',
        color: selectedColor ? selectedColor.dataset.color : '#4CAF50',
        is_loan: isLoan,
        loan_outstanding: isLoan ? loanOutstanding : null,
        loan_roi: isLoan ? loanRoi : null,
        loan_tenure: isLoan ? loanTenure : null,
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
    if (show) recalcLoanPreview();
}

// Solve for monthly interest rate r given P, EMI, n using Newton-Raphson iteration
// Returns monthly rate (decimal) or null if no convergence
function solveMonthlyRate(P, emi, n, maxIter = 100, tol = 1e-8) {
    if (emi * n <= P) return 0; // no interest case
    let r = 0.01; // initial guess: 1% monthly
    for (let i = 0; i < maxIter; i++) {
        const pow = Math.pow(1 + r, n);
        const f  = P * r * pow / (pow - 1) - emi;
        const df = P * (pow * (1 + n * r) - pow + n * r * r * pow / (1 + r)) / Math.pow(pow - 1, 2);
        const rNew = r - f / df;
        if (Math.abs(rNew - r) < tol) return rNew > 0 ? rNew : null;
        r = rNew;
    }
    return null;
}

function recalcLoanPreview() {
    const P = parseFloat(document.getElementById('walletLoanOutstanding').value) || 0;
    const roi = parseFloat(document.getElementById('walletLoanRoi').value) || 0;
    const n   = parseInt(document.getElementById('walletLoanTenure').value) || 0;
    const emiInput = parseFloat(document.getElementById('walletLoanEmi').value) || 0;
    const preview = document.getElementById('loanCalcPreview');

    if (!P || !n) { preview.style.display = 'none'; return; }

    let lines = [];

    if (roi > 0) {
        // Calculate EMI from ROI
        const r = roi / 12 / 100;
        const emi = r > 0 ? Math.round(P * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1) * 100)/100 : P/n;
        const totalPayable = Math.round(emi * n * 100) / 100;
        const totalInterest = Math.round((totalPayable - P) * 100) / 100;
        lines.push(`<b>Monthly EMI:</b> ${emi.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`);
        lines.push(`<b>Total Interest:</b> ${totalInterest.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`);
        lines.push(`<b>Total Payable:</b> ${totalPayable.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`);
    } else if (emiInput > 0) {
        // Back-calculate ROI from EMI
        const r = solveMonthlyRate(P, emiInput, n);
        if (r !== null) {
            const annualRoi = Math.round(r * 12 * 100 * 1000) / 1000;
            const totalPayable = Math.round(emiInput * n * 100) / 100;
            const totalInterest = Math.round((totalPayable - P) * 100) / 100;
            lines.push(`<b>Implied Annual ROI:</b> ${annualRoi}%`);
            lines.push(`<b>Total Interest:</b> ${totalInterest.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`);
            lines.push(`<b>Total Payable:</b> ${totalPayable.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`);
        } else {
            lines.push('<span style="color:var(--expense)">Could not calculate ROI — check EMI value</span>');
        }
    }

    if (lines.length) {
        preview.style.display = 'block';
        preview.innerHTML = lines.join('<br>');
    } else {
        preview.style.display = 'none';
    }
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
