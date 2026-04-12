# WalletApp

![Flask](https://img.shields.io/badge/Flask-3.1.0-000000?logo=flask)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![SQLite](https://img.shields.io/badge/Database-SQLite-003B57?logo=sqlite&logoColor=white)
![Render](https://img.shields.io/badge/Deploy-Render-46E3B7?logo=render&logoColor=000000)
![Status](https://img.shields.io/badge/Status-Active-22C55E)

A personal finance tracker built with Flask. Manage multi-currency wallets, track income and expenses, set budgets, monitor loans with EMI repayment, and visualize spending — all from a sleek dark-themed interface with Material icons.

---

## Features

**Core**
- Multi-currency wallets (EUR, USD, INR, GBP, AUD) with automatic EUR conversion
- Income, expense, transfer, and EMI transactions
- Wallet-to-wallet transfers with custom exchange rates
- Loan accounts with outstanding balance, ROI, tenure, and EMI tracking

**Organization**
- Category-based budgets with monthly progress tracking
- Labels for flexible transaction tagging
- Notes on every transaction

**Analytics**
- Dashboard with balance trend chart and category doughnut
- Statistics page with year-wise and month-wise breakdowns
- Clickable expense categories to drill into transactions

**Import & Export**
- CSV import with column mapping, date format selection, and auto-detection
- CSV export of filtered transactions

**Design**
- Dark theme with black background throughout
- Google Material Symbols Rounded icons
- Progressive Web App (PWA) — installable on any device
- Responsive layout for desktop, tablet, and mobile

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Flask, Flask-SQLAlchemy, Flask-Login |
| Database | SQLite (dev) / PostgreSQL (prod) |
| Frontend | Vanilla JS, Chart.js 4.4.0 |
| Icons | Google Material Symbols Rounded |
| Font | Inter (Google Fonts) |
| Deployment | Gunicorn on Render |

---

## Project Structure

```
run.py                  App entry point
config.py               Configuration and DB URL handling
app/
  __init__.py           App factory, DB init, category seeding
  models.py             SQLAlchemy models
  routes/
    api.py              REST API (transactions, wallets, budgets, stats, import)
    auth.py             Login, register, logout
    main.py             Page routes
  static/
    style.css           Dark theme styles
    app.js              Shared JS (transaction rendering, API helper)
    dashboard.js        Dashboard charts and data
    transactions.js     Transaction list, filters, bulk delete, export
    statistics.js       Statistics charts and drill-down
    budgets.js          Budget management
    wallets.js          Wallet CRUD and icon selector
    loans.js            Loan overview
    import.js           CSV import with column mapping
    sw.js               Service worker for PWA caching
  templates/            Jinja2 templates
bruno/                  Bruno API collection for testing
```

---

## Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/RohanUBagewadi/wallet.git
cd wallet
```

### 2. Create and activate a virtual environment

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Run the app

```bash
python run.py
```

Open `http://127.0.0.1:5000` in your browser. Default categories are seeded automatically on first launch.

---

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SECRET_KEY` | Flask secret key | Production |
| `DATABASE_URL` | PostgreSQL connection string | Production |

If `DATABASE_URL` is not set, the app uses a local SQLite database in `instance/`.

---

## Deployment

### Render

1. Create a PostgreSQL database (e.g. on [Neon](https://neon.tech)).
2. Create a new Web Service on Render from this repository.
3. Set `SECRET_KEY` and `DATABASE_URL` as environment variables.
4. The included `Procfile` handles the rest:

```
web: gunicorn run:app
```

---

## License

No license added yet. Add one if you plan to share this project publicly.