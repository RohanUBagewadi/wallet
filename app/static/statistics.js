/* Statistics page */
Chart.defaults.color = '#8A8A8E';
Chart.defaults.borderColor = '#2A2A2E';
let statsYear = new Date().getFullYear();
let statsMonth = new Date().getMonth() + 1;
let statsViewMode = 'year';
let monthlyChart = null, expenseChart = null;
let selectedExpenseCategory = null;

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function updateStatsHeader() {
    document.getElementById('yearLabel').textContent = statsYear;
    document.getElementById('statsViewMode').value = statsViewMode;
    document.getElementById('statsMonthPicker').style.display = statsViewMode === 'month' ? 'flex' : 'none';
    document.getElementById('monthLabel').textContent = MONTHS[statsMonth - 1];
}

function changeStatsViewMode(mode) {
    statsViewMode = mode === 'month' ? 'month' : 'year';
    selectedExpenseCategory = null;
    updateStatsHeader();
    loadStats();
}

function changeYear(delta) {
    statsYear += delta;
    updateStatsHeader();
    loadStats();
}

function changeStatsMonth(delta) {
    statsMonth += delta;
    if (statsMonth > 12) { statsMonth = 1; statsYear += 1; }
    if (statsMonth < 1) { statsMonth = 12; statsYear -= 1; }
    updateStatsHeader();
    loadStats();
}

function getStatsPeriodDateRange() {
    if (statsViewMode === 'month') {
        const start = `${statsYear}-${String(statsMonth).padStart(2, '0')}-01`;
        const lastDay = new Date(statsYear, statsMonth, 0).getDate();
        const end = `${statsYear}-${String(statsMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        return { start, end };
    }
    return {
        start: `${statsYear}-01-01`,
        end: `${statsYear}-12-31`,
    };
}

async function loadStats() {
    updateStatsHeader();
    const qs = new URLSearchParams({ year: statsYear });
    if (statsViewMode === 'month') qs.set('month', String(statsMonth));
    const data = await api(`/api/analytics?${qs.toString()}`);
    renderMonthly(data.monthly);
    renderCategoryExpense(data.by_category_expense);
    renderCategoryIncome(data.by_category_income);
    renderLabels(data.by_label);
}

function renderMonthly(monthly) {
    const ctx = document.getElementById('monthlyChart').getContext('2d');
    if (monthlyChart) monthlyChart.destroy();
    const labels = monthly.map(m => MONTHS[m.month - 1]);
    monthlyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Income',
                    data: monthly.map(m => m.income),
                    backgroundColor: 'rgba(76,175,80,0.7)',
                    borderRadius: 4,
                },
                {
                    label: 'Expenses',
                    data: monthly.map(m => m.expense),
                    backgroundColor: 'rgba(255,99,132,0.7)',
                    borderRadius: 4,
                },
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top' } },
            scales: {
                y: { beginAtZero: true, ticks: { callback: v => 'EUR' + v } },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderCategoryExpense(cats) {
    const total = cats.reduce((s, c) => s + c.total, 0);
    document.getElementById('totalExpenseBadge').textContent = fmtEur(total);

    // Doughnut
    const ctx = document.getElementById('expenseDoughnut').getContext('2d');
    if (expenseChart) expenseChart.destroy();
    if (cats.length > 0) {
        expenseChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: cats.map(c => c.name),
                datasets: [{ data: cats.map(c => c.total), backgroundColor: cats.map(c => c.color), borderWidth: 0 }]
            },
            options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { display: false } } }
        });
        document.getElementById('expenseLegend').innerHTML = cats.slice(0, 6).map(c => `
            <div class="legend-item" style="cursor:pointer" onclick="selectExpenseCategory(${c.id}, '${c.name.replace(/'/g, "\\'")}')">
                <span class="legend-dot" style="background:${c.color}"></span>
                <span>${c.icon} ${c.name}</span>
                <span style="margin-left:auto;font-weight:600;font-size:.8rem">${Math.round(c.total/total*100)}%</span>
            </div>`).join('');
    } else {
        document.getElementById('expenseLegend').innerHTML = '<div class="tx-empty">No data</div>';
    }

    // Cards
    document.getElementById('expenseCatCards').innerHTML = cats.length === 0
        ? '<div class="tx-empty" style="grid-column:1/-1;padding:20px">No expense data for this period.</div>'
        : cats.map(c => {
            const pct = total > 0 ? (c.total / total) * 100 : 0;
            return `
            <div class="stats-cat-card" style="cursor:pointer" onclick="selectExpenseCategory(${c.id}, '${c.name.replace(/'/g, "\\'")}')">
                <div class="stats-cat-top">
                    <span style="font-size:1.4rem">${c.icon}</span>
                    <div style="flex:1">
                        <div class="stats-cat-name">${c.name}</div>
                        <div class="stats-cat-count">${c.count} transactions</div>
                    </div>
                    <div class="stats-cat-amount" style="color:var(--expense)">${fmtEur(c.total)}</div>
                </div>
                <div class="budget-bar" style="margin-top:8px">
                    <div class="budget-bar-fill" style="width:${pct}%;background:${c.color}"></div>
                </div>
                <div style="font-size:.75rem;color:var(--text-secondary);text-align:right;margin-top:2px">${Math.round(pct)}% of total</div>
            </div>`;
        }).join('');

    if (cats.length === 0) {
        selectedExpenseCategory = null;
        document.getElementById('expenseTxTitle').textContent = 'Expense Transactions';
        document.getElementById('expenseTxList').innerHTML = '<div class="tx-empty">No expense categories available in this period.</div>';
        return;
    }

    if (!selectedExpenseCategory || !cats.some(c => c.id === selectedExpenseCategory.id)) {
        selectExpenseCategory(cats[0].id, cats[0].name);
    } else {
        loadExpenseCategoryTransactions();
    }
}

function renderCategoryIncome(cats) {
    const total = cats.reduce((s, c) => s + c.total, 0);
    document.getElementById('totalIncomeBadge').textContent = fmtEur(total);

    document.getElementById('incomeCatCards').innerHTML = cats.length === 0
        ? '<div class="tx-empty" style="grid-column:1/-1;padding:20px">No income data for this period.</div>'
        : cats.map(c => {
            const pct = total > 0 ? (c.total / total) * 100 : 0;
            return `
            <div class="stats-cat-card">
                <div class="stats-cat-top">
                    <span style="font-size:1.4rem">${c.icon}</span>
                    <div style="flex:1">
                        <div class="stats-cat-name">${c.name}</div>
                        <div class="stats-cat-count">${c.count} transactions</div>
                    </div>
                    <div class="stats-cat-amount" style="color:var(--income)">${fmtEur(c.total)}</div>
                </div>
                <div class="budget-bar" style="margin-top:8px">
                    <div class="budget-bar-fill" style="width:${pct}%;background:${c.color}"></div>
                </div>
                <div style="font-size:.75rem;color:var(--text-secondary);text-align:right;margin-top:2px">${Math.round(pct)}% of total</div>
            </div>`;
        }).join('');
}

function renderLabels(labels) {
    const container = document.getElementById('labelStats');
    if (!labels || labels.length === 0) {
        container.innerHTML = '<div class="tx-empty" style="grid-column:1/-1;padding:20px">No labels used in transactions this period.</div>';
        return;
    }
    container.innerHTML = labels.map(l => `
        <div class="stats-cat-card">
            <div class="stats-cat-top">
                <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${l.color};flex-shrink:0"></span>
                <div style="flex:1">
                    <div class="stats-cat-name">${l.name}</div>
                    <div class="stats-cat-count">${l.count} transactions</div>
                </div>
            </div>
            <div style="display:flex;gap:16px;margin-top:8px;font-size:.85rem">
                <span style="color:var(--expense)">Spent: ${fmtEur(l.total_expense)}</span>
                <span style="color:var(--income)">Earned: ${fmtEur(l.total_income)}</span>
            </div>
        </div>`).join('');
}

function selectExpenseCategory(categoryId, categoryName) {
    selectedExpenseCategory = { id: categoryId, name: categoryName };
    document.getElementById('expenseTxTitle').textContent = `Expense Transactions - ${categoryName}`;
    loadExpenseCategoryTransactions();
}

async function loadExpenseCategoryTransactions() {
    const container = document.getElementById('expenseTxList');
    if (!selectedExpenseCategory) {
        container.innerHTML = '<div class="tx-empty">Select a category to view transactions.</div>';
        return;
    }

    const range = getStatsPeriodDateRange();
    const qs = new URLSearchParams({
        type: 'expense',
        category_id: String(selectedExpenseCategory.id),
        start: range.start,
        end: range.end,
    });
    const txns = await api(`/api/transactions?${qs.toString()}`);

    if (!txns || txns.length === 0) {
        container.innerHTML = '<div class="tx-empty">No transactions for this category in the selected period.</div>';
        return;
    }

    let html = '';
    let lastDate = '';
    for (const tx of txns) {
        if (tx.date !== lastDate) {
            lastDate = tx.date;
            html += `<div class="date-group-header">${formatDate(tx.date)}</div>`;
        }
        html += renderTxItem(tx, false, false);
    }
    container.innerHTML = html;
}

function refreshPage() { loadStats(); }

// Init
updateStatsHeader();
loadStats();
