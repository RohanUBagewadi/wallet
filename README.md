# WalletApp

![Flask](https://img.shields.io/badge/Flask-3.1.0-000000?logo=flask)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![SQLite](https://img.shields.io/badge/Database-SQLite-003B57?logo=sqlite&logoColor=white)
![Render](https://img.shields.io/badge/Deploy-Render-46E3B7?logo=render&logoColor=000000)
![Status](https://img.shields.io/badge/Status-Active-22C55E)

WalletApp is a Flask-based personal finance tracker inspired by Spendee. It supports multi-currency wallets, income and expense transactions, transfers, budgets, labels, statistics, and loan accounts with EMI repayment tracking.

## Features

- User registration and login
- Multi-currency wallets
- Income, expense, transfer, and EMI transactions
- Loan accounts with outstanding balance, ROI, and tenure
- Wallet-to-wallet transfers with exchange-rate support
- Budgets by category and month
- Labels for transaction organization
- Dashboard and statistics views
- CSV import and export
- PWA-friendly frontend with an installable app shell

## Screenshots

Add your own screenshots here to show the app in action. Recommended images:

- Dashboard
- Wallets and loan accounts
- Transactions page
- Statistics page

Example layout:

```md
![Dashboard](docs/screenshots/dashboard.png)
![Wallets](docs/screenshots/wallets.png)
![Transactions](docs/screenshots/transactions.png)
![Statistics](docs/screenshots/statistics.png)
```

## Tech Stack

- Flask
- Flask-SQLAlchemy
- Flask-Login
- Flask-WTF
- SQLite for local development
- PostgreSQL for production deployment
- Chart.js for analytics charts

## Project Structure

- `run.py` - app entry point for local development and Gunicorn
- `config.py` - application configuration and database URL handling
- `app/` - Flask application package
- `app/routes/` - main, auth, and API routes
- `app/models.py` - database models
- `app/static/` - JavaScript, CSS, icons, and service worker
- `app/templates/` - Jinja templates
- `bruno/` - API request collection

## Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/RohanUBagewadi/wallet.git
cd wallet
```

### 2. Create and activate a virtual environment

Windows PowerShell:

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

Open `http://127.0.0.1:5000` in your browser.

## Environment Variables

The app uses these environment variables in production:

- `SECRET_KEY` - Flask secret key
- `DATABASE_URL` - PostgreSQL connection string

If `DATABASE_URL` is not set, the app falls back to a local SQLite database in the `instance/` folder.

## Database Notes

For local development, SQLite is used automatically.

For production, use a PostgreSQL database. A free option is Neon. Set the connection string in `DATABASE_URL` on your hosting platform.

Note: pCloud is file storage, not a database host, so it cannot be used to run the app database.

## Deployment

This project is ready for Render deployment.

### Render

1. Create a free PostgreSQL database on Neon.
2. Create a new Render Web Service from this GitHub repository.
3. Use the included `Procfile` with Gunicorn.
4. Set these environment variables on Render:
   - `SECRET_KEY`
   - `DATABASE_URL`

### Gunicorn command

The service entry point is already configured for Render:

```bash
web: gunicorn run:app
```

## Default Data

On first launch, the app seeds default income and expense categories automatically.

## License

No license has been added yet. Add one if you plan to publish or share this project publicly.