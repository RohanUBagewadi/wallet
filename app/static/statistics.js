/* Statistics page */
let statsYear = new Date().getFullYear();
let monthlyChart = null, expenseChart = null;

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function changeYear(delta) {
    statsYear += delta;
    document.getElementById('yearLabel').textContent = statsYear;
    loadStats();
}

async function loadStats() {
    document.getElementById('yearLabel').textContent = statsYear;
    const data = await api(`/api/analytics?year=${statsYear}`);
    renderMonthly(data.monthly);
    renderCategoryExpense(data.by_category_expense);
    renderCategoryIncome(data.by_category_income);
    renderLabels(data.by_label);
}

function renderMonthly(monthly) {
    const ctx = document.getElementById('monthlyChart').getContext('2d');
    if (monthlyChart) monthlyChart.destroy();
    monthlyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: MONTHS,
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
            <div class="legend-item">
                <span class="legend-dot" style="background:${c.color}"></span>
                <span>${c.icon} ${c.name}</span>
                <span style="margin-left:auto;font-weight:600;font-size:.8rem">${Math.round(c.total/total*100)}%</span>
            </div>`).join('');
    } else {
        document.getElementById('expenseLegend').innerHTML = '<div class="tx-empty">No data</div>';
    }

    // Cards
    document.getElementById('expenseCatCards').innerHTML = cats.length === 0
        ? '<div class="tx-empty" style="grid-column:1/-1;padding:20px">No expense data for this year.</div>'
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
                    <div class="stats-cat-amount" style="color:var(--expense)">${fmtEur(c.total)}</div>
                </div>
                <div class="budget-bar" style="margin-top:8px">
                    <div class="budget-bar-fill" style="width:${pct}%;background:${c.color}"></div>
                </div>
                <div style="font-size:.75rem;color:var(--text-secondary);text-align:right;margin-top:2px">${Math.round(pct)}% of total</div>
            </div>`;
        }).join('');
}

function renderCategoryIncome(cats) {
    const total = cats.reduce((s, c) => s + c.total, 0);
    document.getElementById('totalIncomeBadge').textContent = fmtEur(total);

    document.getElementById('incomeCatCards').innerHTML = cats.length === 0
        ? '<div class="tx-empty" style="grid-column:1/-1;padding:20px">No income data for this year.</div>'
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
        container.innerHTML = '<div class="tx-empty" style="grid-column:1/-1;padding:20px">No labels used in transactions this year.</div>';
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

function refreshPage() { loadStats(); }

// Init
loadStats();
