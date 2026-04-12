/* Categories page */

async function loadCategories() {
    const cats = await api('/api/categories');
    const expense = cats.filter(c => c.type === 'expense');
    const income = cats.filter(c => c.type === 'income');

    document.getElementById('expenseCount').textContent = `(${expense.length})`;
    document.getElementById('incomeCount').textContent = `(${income.length})`;

    document.getElementById('expenseCatList').innerHTML = expense.length
        ? expense.map(renderCatChip).join('')
        : '<div style="color:var(--text-secondary);padding:12px">No expense categories yet.</div>';

    document.getElementById('incomeCatList').innerHTML = income.length
        ? income.map(renderCatChip).join('')
        : '<div style="color:var(--text-secondary);padding:12px">No income categories yet.</div>';
}

function renderCatChip(c) {
    return `
    <div class="cat-chip">
        <div class="cat-chip-icon" style="background:${c.color}22;color:${c.color}">${c.icon}</div>
        <span class="cat-chip-name">${c.name}</span>
        <button class="cat-chip-delete" onclick="deleteCategory(${c.id}, '${c.name.replace(/'/g, "\\'")}')" title="Delete">
            <span class="mi" style="font-size:18px">delete</span>
        </button>
    </div>`;
}

async function addCategory() {
    const name = document.getElementById('newCatName').value.trim();
    const type = document.getElementById('newCatType').value;
    const color = document.getElementById('newCatColor').value;
    const icon = document.getElementById('newCatIcon').value.trim() || '📦';

    if (!name) { showToast('Enter a category name'); return; }

    const res = await api('/api/categories', 'POST', { name, type, color, icon });
    if (res.error) {
        showToast(res.error);
        return;
    }
    showToast(`Category "${name}" added`);
    document.getElementById('newCatName').value = '';
    loadCategories();
}

async function deleteCategory(id, name) {
    if (!confirm(`Delete category "${name}"?\n\nThis will fail if any transactions use this category.`)) return;
    const res = await api(`/api/categories/${id}`, 'DELETE');
    if (res.error) {
        showToast(res.error);
        return;
    }
    showToast(`Category "${name}" deleted`);
    loadCategories();
}

loadCategories();
