/* Loans page */
// Bank EMI formula: EMI = P × r × (1+r)^n / ((1+r)^n - 1)
// P = original principal, r = monthly rate (annual_rate/12/100), n = tenure months
// Uses server-calculated EMI (api/loans) which applies this exact formula
// Falls back to client-side calculation only if server does not return emi

function clientCalcEmi(principal, roi, tenure) {
    const r = roi / 12 / 100;
    const n = tenure;
    return r > 0
        ? Math.round(principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1) * 100) / 100
        : Math.round(principal / n * 100) / 100;
}

async function loadLoans() {
    const loans = await api('/api/loans');

    // Summary — use server-computed emi values
    const totalOutstanding = loans.reduce((s, l) => s + (l.balance_eur || 0), 0);
    const totalEmi = loans.reduce((s, l) => s + (l.emi || 0), 0);

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
            <span class="stat-sub">combined monthly EMI</span>
        </div>
    `;

    const container = document.getElementById('loansList');
    if (loans.length === 0) {
        container.innerHTML = '<div class="tx-empty" style="grid-column:1/-1;padding:60px 20px">No loan accounts yet.<br>Go to <a href="/wallets" style="color:var(--primary)">Wallets</a> and tick "Mark as Loan Account".</div>';
        return;
    }

    container.innerHTML = loans.map(l => {
        // Use server-computed EMI; fall back to client formula only if absent
        const emi = l.emi || (l.loan_outstanding && l.loan_roi && l.loan_tenure
            ? clientCalcEmi(l.loan_outstanding, l.loan_roi, l.loan_tenure) : null);

        const principal = l.loan_outstanding || l.balance;  // original sanctioned amount
        const paid = l.paid_amount || 0;
        const outstanding = l.balance;
        const pct = principal > 0 ? Math.min(100, (paid / principal) * 100) : 0;
        const eurNote = l.currency !== 'EUR' ? `<span class="wallet-eur-eq">≈ ${fmtEur(l.balance_eur)}</span>` : '';
        const progressColor = pct >= 75 ? 'var(--income)' : pct >= 40 ? '#FF9800' : 'var(--expense)';

        // Bank-style totals
        const totalPayable   = emi && l.loan_tenure ? emi * l.loan_tenure : null;
        const totalInterest  = totalPayable ? totalPayable - principal : null;

        return `
        <div class="budget-card" style="border-left:4px solid var(--expense)">
            <div class="budget-header">
                <div style="display:flex;align-items:center;gap:10px">
                    <span class="mi" style="font-size:1.5rem">${l.icon}</span>
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
                    <span>Principal: ${l.symbol}${(principal).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                    ${l.loan_tenure ? `<span>${l.loan_tenure} months tenure</span>` : ''}
                </div>
            </div>

            ${emi ? `
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:12px;background:var(--surface);border-radius:8px;padding:10px">
                <div style="text-align:center">
                    <div style="font-size:.7rem;color:var(--text-secondary)">Monthly EMI</div>
                    <div style="font-size:.88rem;font-weight:700;color:#1565C0">${l.symbol}${emi.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                </div>
                <div style="text-align:center">
                    <div style="font-size:.7rem;color:var(--text-secondary)">Total Interest</div>
                    <div style="font-size:.88rem;font-weight:700;color:var(--expense)">${totalInterest !== null ? l.symbol + totalInterest.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}</div>
                </div>
                <div style="text-align:center">
                    <div style="font-size:.7rem;color:var(--text-secondary)">Total Payable</div>
                    <div style="font-size:.88rem;font-weight:700">${totalPayable !== null ? l.symbol + totalPayable.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}</div>
                </div>
            </div>` : ''}

            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;font-size:.82rem">
                ${l.loan_roi ? `<span class="tag-badge">ROI: ${l.loan_roi}% p.a.</span>` : ''}
                ${l.loan_note ? `<span class="tag-badge">${escapeHtml(l.loan_note)}</span>` : ''}
            </div>

            <div style="display:flex;gap:8px;margin-top:14px">
                <a href="/loan/${l.id}/overview" class="btn btn-primary btn-sm" style="flex:1;text-align:center;text-decoration:none" onclick="event.stopPropagation()">
                    <span class="mi" style="font-size:16px;vertical-align:-3px">table_chart</span> See Overview
                </a>
                <a href="/wallet/${l.id}" class="btn btn-outline btn-sm" style="flex:1;text-align:center;text-decoration:none" onclick="event.stopPropagation()">
                    <span class="mi" style="font-size:16px;vertical-align:-3px">receipt_long</span> Transactions
                </a>
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
