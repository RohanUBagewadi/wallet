/* Budgets page */
let budgetMonth = new Date().getMonth() + 1;
let budgetYear = new Date().getFullYear();

function updateBudgetMonthLabel() {
    const d = new Date(budgetYear, budgetMonth - 1);
    document.getElementById('budgetMonthLabel').textContent =
        d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function changeBudgetMonth(delta) {
    budgetMonth += delta;
    if (budgetMonth > 12) { budgetMonth = 1; budgetYear++; }
    if (budgetMonth < 1)  { budgetMonth = 12; budgetYear--; }
    updateBudgetMonthLabel();
    loadBudgets();
}

async function openAddBudgetModal() {
    await loadBudgetCategories();
    document.getElementById('budgetAmount').value = '';
    openModal('addBudgetModal');
}

function budgetColor(pct) {
    if (pct >= 100) return 'var(--expense)';
    if (pct >= 75)  return '#FF9800';
    return 'var(--income)';
}

async function loadBudgetCategories() {
    const cats = await api('/api/categories');
    const sel = document.getElementById('budgetCategory');
    const expenseCats = cats.filter(c => c.type === 'expense');
    sel.innerHTML = expenseCats.map(c =>
        `<option value="${c.id}">${c.icon} ${c.name}</option>`
    ).join('');
}

async function loadBudgets() {
    const budgets = await api(`/api/budgets?month=${budgetMonth}&year=${budgetYear}`);
    const container = document.getElementById('budgetsList');

    const totalBudget = budgets.reduce((s, b) => s + b.amount, 0);
    const totalSpent  = budgets.reduce((s, b) => s + b.spent,  0);
    const totalPct    = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
    const diff        = totalBudget - totalSpent;
    const netColor    = diff >= 0 ? 'var(--income)' : 'var(--expense)';

    document.getElementById('budgetSummary').innerHTML = `
        <div class="stat-card" style="flex:1">
            <span class="stat-label">Total Budget</span>
            <span class="stat-value" style="color:var(--primary)">${fmtEur(totalBudget)}</span>
        </div>
        <div class="stat-card" style="flex:1">
            <span class="stat-label">Total Spent</span>
            <span class="stat-value" style="color:${budgetColor(totalPct)}">${fmtEur(totalSpent)}</span>
            <span class="stat-sub">${Math.round(totalPct)}% used</span>
        </div>
        <div class="stat-card" style="flex:1">
            <span class="stat-label">${diff >= 0 ? 'Remaining' : 'Over Budget'}</span>
            <span class="stat-value" style="color:${netColor}">${fmtEur(Math.abs(diff))}</span>
        </div>
    `;

    if (budgets.length === 0) {
        container.innerHTML = '<div class="tx-empty" style="grid-column:1/-1;padding:60px 20px">No budgets set for this month.<br>Tap <strong>+</strong> to add one.</div>';
        return;
    }

    container.innerHTML = budgets.map(b => {
        const rawPct     = b.amount > 0 ? (b.spent / b.amount) * 100 : 0;
        const clampedPct = Math.min(rawPct, 100);
        const over       = b.spent > b.amount;
        const color      = budgetColor(rawPct);
        const statusIcon = rawPct >= 100 ? 'Over!' : rawPct >= 75 ? 'Warning' : 'On track';
        return `
        <div class="budget-card ${over ? 'budget-over' : ''}">
            <div class="budget-header">
                <div class="budget-cat">
                    <span class="budget-cat-icon">${b.category.icon}</span>
                    <span class="budget-cat-name">${b.category.name}</span>
                    <span class="budget-pct-badge" style="background:${color}22;color:${color}">${Math.round(rawPct)}%</span>
                </div>
                <div class="budget-card-actions">
                    <button class="btn-icon-del" onclick="openEditBudget(${b.id}, ${b.amount}, '${b.category.icon} ${b.category.name}')" title="Edit">✏️</button>
                    <button class="btn-icon-del" onclick="deleteBudget(${b.id})" title="Delete">×</button>
                </div>
            </div>
            <div class="budget-bar" title="${Math.round(rawPct)}% used">
                <div class="budget-bar-fill" style="width:${clampedPct}%;background:${color}"></div>
            </div>
            <div class="budget-amounts">
                <span style="color:${color};font-weight:600">${fmtEur(b.spent)} spent</span>
                <span style="color:var(--text-secondary)">of ${fmtEur(b.amount)}</span>
            </div>
            <div class="budget-status" style="color:${color}">
                ${statusIcon}: ${over
                    ? `Over by ${fmtEur(b.spent - b.amount)}`
                    : `${fmtEur(b.amount - b.spent)} remaining`}
            </div>
        </div>`;
    }).join('');
}

async function saveBudget() {
    const catId  = parseInt(document.getElementById('budgetCategory').value);
    const amount = parseFloat(document.getElementById('budgetAmount').value);
    if (!catId)                  { showToast('Select a category'); return; }
    if (!amount || amount <= 0)  { showToast('Enter a valid amount'); return; }

    const res = await api('/api/budgets', 'POST', {
        category_id: catId,
        amount,
        month: budgetMonth,
        year:  budgetYear,
    });
    if (res && res.error) { showToast(res.error); return; }
    closeModal('addBudgetModal');
    showToast('Budget saved');
    loadBudgets();
}

async function deleteBudget(id) {
    if (!confirm('Delete this budget?')) return;
    await api(`/api/budgets/${id}`, 'DELETE');
    showToast('Budget deleted');
    loadBudgets();
}

let _editBudgetId = null;

function openEditBudget(id, amount, categoryName) {
    _editBudgetId = id;
    document.getElementById('editBudgetAmount').value = amount;
    document.getElementById('editBudgetCategoryName').value = categoryName;
    openModal('editBudgetModal');
}

async function saveEditBudget() {
    const amount = parseFloat(document.getElementById('editBudgetAmount').value);
    if (!amount || amount <= 0) { showToast('Enter a valid amount'); return; }
    const res = await api(`/api/budgets/${_editBudgetId}`, 'PUT', { amount });
    if (res && res.error) { showToast(res.error); return; }
    closeModal('editBudgetModal');
    showToast('Budget updated');
    loadBudgets();
}

function refreshPage() { loadBudgets(); }

// Init
updateBudgetMonthLabel();
loadBudgets();
