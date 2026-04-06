/* Loans page */

function calcEmiInfo(l) {
    const principal = l.loan_outstanding || l.balance;
    if (!l.loan_roi || !l.loan_tenure || !principal) return null;
    const r = l.loan_roi / 12 / 100;
    const n = l.loan_tenure;
    const emi = r > 0 ? principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1) : principal / n;
    return { emi: Math.round(emi * 100) / 100, principal };
}

async function loadLoans() {
    const loans = await api('/api/loans');

    // Summary
    const totalOutstanding = loans.reduce((s, l) => s + (l.balance_eur || 0), 0);
    const totalEmi = loans.reduce((s, l) => {
        const info = calcEmiInfo(l);
        return s + (info ? info.emi : 0);
    }, 0);

    document.getElementById('loanSummary').innerHTML = `
        <div class="stat-card" style="flex:1">
            <span class="stat-label">ACTIVE LOANS</span>
            <span class="stat-value" style="color:var(--expense)">${loans.length}</span>
            <span class="stat-sub">loan account${loans.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="stat-card" style="flex:1">
            <span class="stat-label">TOTAL OUTSTANDING</span>
            <span class="stat-value" style="color:var(--expense)">${fmtEur(totalOutstanding)}</span>
            <span class="stat-sub">approx EUR equivalent</span>
        </div>
        <div class="stat-card" style="flex:1">
            <span class="stat-label">MONTHLY EMI</span>
            <span class="stat-value" style="color:var(--text-secondary)">${fmtEur(totalEmi)}</span>
            <span class="stat-sub">combined EMI estimate</span>
        </div>
    `;

    const container = document.getElementById('loansList');
    if (loans.length === 0) {
        container.innerHTML = '<div class="tx-empty" style="grid-column:1/-1;padding:60px 20px">No loan accounts yet.<br>Go to <a href="/wallets" style="color:var(--primary)">Wallets</a> and tick "Mark as Loan Account".</div>';
        return;
    }

    container.innerHTML = loans.map(l => {
        const emiInfo = calcEmiInfo(l);
        const emi = emiInfo ? emiInfo.emi : null;
        const principal = l.loan_outstanding || l.balance;
        const paid = l.paid_amount || 0;
        const outstanding = l.balance;
        const pct = principal > 0 ? Math.min(100, (paid / principal) * 100) : 0;
        const eurNote = l.currency !== 'EUR' ? `<span class="wallet-eur-eq">≈ ${fmtEur(l.balance_eur)}</span>` : '';

        const progressColor = pct >= 75 ? 'var(--income)' : pct >= 40 ? '#FF9800' : 'var(--expense)';

        return `
        <div class="budget-card" style="border-left:4px solid var(--expense);cursor:pointer" onclick="window.location.href='/wallet/${l.id}'">
            <div class="budget-header">
                <div style="display:flex;align-items:center;gap:10px">
                    <span style="font-size:1.5rem">${l.icon}</span>
                    <div>
                        <div style="font-weight:700;font-size:.95rem">${escapeHtml(l.name)}</div>
                        ${l.loan_counterparty ? `<div style="font-size:.8rem;color:var(--text-secondary)">${escapeHtml(l.loan_counterparty)}</div>` : ''}
                    </div>
                </div>
                <span class="tx-currency-badge">${l.currency}</span>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0 10px">
                <div>
                    <div style="font-size:.75rem;color:var(--text-secondary)">Outstanding</div>
                    <div style="font-size:1.2rem;font-weight:700;color:var(--expense)">${l.symbol}${outstanding.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} ${eurNote}</div>
                </div>
                <div>
                    <div style="font-size:.75rem;color:var(--text-secondary)">Paid so far</div>
                    <div style="font-size:1.2rem;font-weight:700;color:var(--income)">${l.symbol}${paid.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                </div>
            </div>

            <div>
                <div style="display:flex;justify-content:space-between;font-size:.78rem;color:var(--text-secondary);margin-bottom:4px">
                    <span>Repayment progress</span>
                    <span style="font-weight:600;color:${progressColor}">${Math.round(pct)}%</span>
                </div>
                <div class="budget-bar">
                    <div class="budget-bar-fill" style="width:${pct}%;background:${progressColor}"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--text-secondary);margin-top:4px">
                    <span>Principal: ${l.symbol}${(principal).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0})}</span>
                    ${l.loan_tenure ? `<span>${l.loan_tenure} months tenure</span>` : ''}
                </div>
            </div>

            <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;font-size:.82rem">
                ${l.loan_roi ? `<span class="tag-badge">ROI: ${l.loan_roi}% p.a.</span>` : ''}
                ${emi ? `<span class="tag-badge" style="background:#E3F2FD;color:#1565C0">EMI ≈ ${l.symbol}${emi.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}/mo</span>` : ''}
                ${l.loan_note ? `<span class="tag-badge">${escapeHtml(l.loan_note)}</span>` : ''}
            </div>
        </div>`;
    }).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function refreshPage() { loadLoans(); }
loadLoans();
