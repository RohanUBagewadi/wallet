/* Dashboard page */
Chart.defaults.color = '#8A8A8E';
Chart.defaults.borderColor = '#2A2A2E';
let currentMonth = new Date().getMonth() + 1;
let currentYear = new Date().getFullYear();
let lineChart = null;
let doughnutChart = null;

function updateMonthLabel() {
    const d = new Date(currentYear, currentMonth - 1);
    document.getElementById('monthLabel').textContent = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function changeMonth(delta) {
    currentMonth += delta;
    if (currentMonth > 12) { currentMonth = 1; currentYear++; }
    if (currentMonth < 1) { currentMonth = 12; currentYear--; }
    updateMonthLabel();
    refreshPage();
}

async function refreshPage() {
    const lastDay = new Date(currentYear, currentMonth, 0).getDate();
    const startStr = `${currentYear}-${String(currentMonth).padStart(2,'0')}-01`;
    const endStr   = `${currentYear}-${String(currentMonth).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    const [stats, txns] = await Promise.all([
        api(`/api/stats?month=${currentMonth}&year=${currentYear}`),
        api(`/api/transactions?start=${startStr}&end=${endStr}`)
    ]);

    // Total wealth (all time, all wallets, in EUR)
    document.getElementById('statBalance').textContent = fmtEur(stats.total_balance_eur || 0);

    // Monthly income / expense
    document.getElementById('statIncome').textContent = '+' + fmtEur(stats.income);
    document.getElementById('statExpense').textContent = '-' + fmtEur(stats.expense);

    // Net savings this month
    const savings = stats.net_savings || (stats.income - stats.expense);
    const savingsEl = document.getElementById('statSavings');
    const savingsLabel = document.getElementById('savingsLabel');
    savingsEl.textContent = (savings >= 0 ? '+' : '-') + fmtEur(Math.abs(savings));
    savingsEl.style.color = savings >= 0 ? 'var(--income)' : 'var(--expense)';
    savingsLabel.innerHTML = savings >= 0 ? '<span class="mi">savings</span> Net Savings' : '<span class="mi" style="color:var(--expense)">trending_down</span> Net Loss';

    // Wallet breakdown
    renderWalletBreakdown(stats.wallets_summary || [], stats.total_balance_eur || 0);

    // Charts
    renderLineChart(stats.daily_balance);
    renderDoughnutChart(stats.by_category);

    // Recent transactions (last 5)
    const container = document.getElementById('recentTransactions');
    if (!txns || txns.length === 0) {
        container.innerHTML = '<div class="tx-empty">No transactions this month. Tap + to add one.</div>';
    } else {
        container.innerHTML = txns.slice(0, 5).map(t => renderTxItem(t)).join('');
    }
}

function renderWalletBreakdown(wallets, totalEur) {
    document.getElementById('totalWealthBadge').textContent = 'Total: ' + fmtEur(totalEur);

    const grid = document.getElementById('walletBreakdownGrid');
    if (!wallets.length) {
        grid.innerHTML = '<div class="tx-empty" style="padding:24px">No wallets yet.</div>';
        return;
    }
    grid.innerHTML = wallets.map(w => {
        const eurPct = totalEur > 0 ? Math.round((w.balance_eur / totalEur) * 100) : 0;
        const balFmt = w.symbol + Math.abs(w.balance).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        const eurFmt = w.currency !== 'EUR' ? `<span class="wallet-eur-eq">≈ ${fmtEur(w.balance_eur)}</span>` : '';
        return `
        <div class="wallet-mini-card" style="border-left:4px solid ${w.color}">
            <div class="wallet-mini-icon">${/^[a-z_]+$/.test(w.icon) ? `<span class="mi">${w.icon}</span>` : w.icon}</div>
            <div class="wallet-mini-info">
                <div class="wallet-mini-name">${w.name} <span class="tx-currency-badge">${w.currency}</span></div>
                <div class="wallet-mini-balance">${balFmt} ${eurFmt}</div>
            </div>
            <div class="wallet-mini-pct" style="color:${w.color}">${eurPct}%</div>
        </div>`;
    }).join('');
}

function renderLineChart(dailyBalance) {
    const ctx = document.getElementById('lineChart').getContext('2d');
    if (lineChart) lineChart.destroy();

    if (!dailyBalance || dailyBalance.length === 0) {
        lineChart = null;
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        return;
    }

    const labels = dailyBalance.map(d => {
        const dt = new Date(d.date + 'T00:00:00');
        return dt.getDate();
    });
    const data = dailyBalance.map(d => d.balance);

    const isRising = data.length < 2 || data[data.length - 1] >= data[0];
    const lineColor = isRising ? '#4CAF50' : '#F44336';
    const fillColor = isRising ? 'rgba(76,175,80,0.10)' : 'rgba(244,67,54,0.10)';

    lineChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Balance (EUR)',
                data,
                borderColor: lineColor,
                backgroundColor: fillColor,
                fill: true,
                tension: 0.4,
                pointRadius: 3,
                pointBackgroundColor: lineColor,
                pointHoverRadius: 5,
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => '€' + ctx.parsed.y.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    ticks: { callback: v => '€' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }) }
                },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderDoughnutChart(categories) {
    const ctx = document.getElementById('doughnutChart').getContext('2d');
    if (doughnutChart) doughnutChart.destroy();

    if (categories.length === 0) {
        document.getElementById('categoryLegend').innerHTML = '<div class="tx-empty">No expenses yet</div>';
        return;
    }

    doughnutChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: categories.map(c => c.name),
            datasets: [{
                data: categories.map(c => c.total),
                backgroundColor: categories.map(c => c.color),
                borderWidth: 0,
            }]
        },
        options: {
            responsive: true,
            cutout: '65%',
            plugins: { legend: { display: false } }
        }
    });

    // Legend
    const total = categories.reduce((s, c) => s + c.total, 0);
    document.getElementById('categoryLegend').innerHTML = categories.map(c => `
        <div class="legend-item">
            <span class="legend-dot" style="background:${c.color}"></span>
            <span>${c.icon} ${c.name}</span>
            <span style="margin-left:auto;font-weight:600">${fmtEur(c.total)}</span>
            <span style="color:var(--text-secondary);font-size:.8rem">${Math.round(c.total/total*100)}%</span>
        </div>
    `).join('');
}

// Init
updateMonthLabel();
refreshPage();
