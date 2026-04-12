/* Loan Overview page */

async function loadLoanOverview() {
    const data = await api(`/api/loans/${WALLET_ID}/schedule`);
    if (!data || data.error) {
        document.getElementById('loanTitle').textContent = 'Loan not found';
        document.getElementById('scheduleBody').innerHTML =
            '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-secondary)">Could not load schedule.</td></tr>';
        return;
    }

    const w = data.wallet;
    const sym = data.symbol;
    document.getElementById('loanTitle').innerHTML = `<span class="mi" style="vertical-align:-3px">${w.icon}</span> ${w.name}`;
    document.getElementById('loanSubtitle').textContent =
        (w.loan_counterparty ? '🏦 ' + w.loan_counterparty + ' · ' : '') + `${data.roi}% p.a. · ${data.tenure} months`;
    document.title = w.name + ' – Loan Overview';

    // Summary cards
    const totalInterest = data.schedule.length > 0 ? data.schedule[data.schedule.length - 1].total_interest : 0;
    const totalPayable = data.principal + totalInterest;
    const paid = Math.max(0, data.principal - w.balance);
    const paidPct = data.principal > 0 ? Math.round(paid / data.principal * 100) : 0;
    const actualCount = data.schedule.filter(r => r.has_actual).length;

    document.getElementById('loanSummaryCards').innerHTML = `
        <div class="loan-stat">
            <div class="loan-stat-label">Principal</div>
            <div class="loan-stat-value">${sym}${fmt(data.principal)}</div>
        </div>
        <div class="loan-stat">
            <div class="loan-stat-label">Monthly EMI</div>
            <div class="loan-stat-value" style="color:#1565C0">${sym}${fmt(data.emi)}</div>
        </div>
        <div class="loan-stat">
            <div class="loan-stat-label">Total Interest</div>
            <div class="loan-stat-value" style="color:var(--expense)">${sym}${fmt(totalInterest)}</div>
        </div>
        <div class="loan-stat">
            <div class="loan-stat-label">Total Payable</div>
            <div class="loan-stat-value">${sym}${fmt(totalPayable)}</div>
        </div>
        <div class="loan-stat">
            <div class="loan-stat-label">Paid So Far</div>
            <div class="loan-stat-value" style="color:var(--income)">${sym}${fmt(paid)} (${paidPct}%)</div>
        </div>
        <div class="loan-stat">
            <div class="loan-stat-label">Payments Made</div>
            <div class="loan-stat-value">${actualCount} / ${data.tenure}</div>
        </div>
    `;

    // Schedule table
    const today = new Date().toISOString().split('T')[0];
    const tbody = document.getElementById('scheduleBody');
    tbody.innerHTML = data.schedule.map(r => {
        let rowClass = '';
        if (r.has_actual) rowClass = 'actual-row';
        else if (r.date_iso > today) rowClass = 'future-row';
        const extraCell = r.extra_payment > 0
            ? `<span class="extra-badge">${sym}${fmt(r.extra_payment)}</span>`
            : `${sym}0.00`;
        return `<tr class="${rowClass}">
            <td>${r.pmt_no}</td>
            <td>${r.date}</td>
            <td>${sym}${fmt(r.beginning_balance)}</td>
            <td>${sym}${fmt(r.payment)}</td>
            <td>${extraCell}</td>
            <td>${sym}${fmt(r.principal)}</td>
            <td>${sym}${fmt(r.interest)}</td>
            <td>${sym}${fmt(r.ending_balance)}</td>
            <td>${sym}${fmt(r.total_interest)}</td>
        </tr>`;
    }).join('');
}

function fmt(val) {
    return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

loadLoanOverview();
