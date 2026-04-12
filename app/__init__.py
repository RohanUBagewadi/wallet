from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from config import Config

db = SQLAlchemy()
login_manager = LoginManager()
login_manager.login_view = "auth.login"


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    db.init_app(app)
    login_manager.init_app(app)

    from app.models import User

    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(User, int(user_id))

    from app.routes.auth import auth_bp
    from app.routes.main import main_bp
    from app.routes.api import api_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(main_bp)
    app.register_blueprint(api_bp, url_prefix="/api")

    with app.app_context():
        db.create_all()
        _migrate_db()
        _seed_default_categories()
        # Process any due recurring transactions at startup
        from app.routes.api import process_recurring_transactions
        process_recurring_transactions()

    @app.before_request
    def _check_recurring():
        """Process recurring transactions once per day per app instance."""
        from datetime import date as _date
        today = _date.today()
        if getattr(app, '_last_recurring_check', None) != today:
            app._last_recurring_check = today
            from app.routes.api import process_recurring_transactions
            process_recurring_transactions()

    return app


def _migrate_db():
    """Add new columns to existing tables without losing data."""
    from sqlalchemy import text
    cols = [
        ("wallet", "is_loan", "BOOLEAN DEFAULT 0"),
        ("wallet", "loan_counterparty", "VARCHAR(100) DEFAULT ''"),
        ("wallet", "loan_note", "VARCHAR(200) DEFAULT ''"),
        ("wallet", "loan_outstanding", "REAL"),
        ("wallet", "loan_roi", "REAL"),
        ("wallet", "loan_tenure", "INTEGER"),
        ("transfer", "is_extra_payment", "BOOLEAN DEFAULT 0"),
        ("wallet", "is_credit_card", "BOOLEAN DEFAULT 0"),
    ]
    with db.engine.connect() as conn:
        for table, col, defn in cols:
            try:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {defn}"))
                conn.commit()
            except Exception:
                pass  # column already exists


def _seed_default_categories():
    from app.models import Category

    defaults = [
        # Expense categories
        ("Food & Drinks", "expense", "#FF6384", "🍔"),
        ("Shopping", "expense", "#36A2EB", "🛍️"),
        ("Transport", "expense", "#FFCE56", "🚗"),
        ("Housing", "expense", "#4BC0C0", "🏠"),
        ("Entertainment", "expense", "#9966FF", "🎬"),
        ("Health", "expense", "#FF9F40", "💊"),
        ("Education", "expense", "#C9CBCF", "📚"),
        ("Bills & Utilities", "expense", "#7C4DFF", "💡"),
        ("Groceries", "expense", "#00BCD4", "🛒"),
        ("Other", "expense", "#607D8B", "📦"),
        ("Gym", "expense", "#EF5350", "🏋️"),
        ("Sport & Hobbies", "expense", "#AB47BC", "🏸"),
        ("Gifts", "expense", "#FFA726", "🎁"),
        ("Driving licence", "expense", "#5C6BC0", "🪪"),
        ("Shopping India", "expense", "#29B6F6", "🛒"),
        ("RJ", "expense", "#7E57C2", "🧾"),
        ("Transfer", "expense", "#26A69A", "🔁"),
        ("Bills & Fees", "expense", "#8E24AA", "🧾"),
        ("Mobile Recharge", "expense", "#26C6DA", "📱"),
        ("Medical", "expense", "#FF7043", "🩺"),
        ("Deal Doctor", "expense", "#8D6E63", "📄"),
        ("Food & Drink", "expense", "#EC407A", "🍽️"),
        ("Beauty", "expense", "#F06292", "💄"),
        ("Work", "expense", "#78909C", "💼"),
        ("Stocks", "expense", "#66BB6A", "📉"),
        ("Family & Personal", "expense", "#42A5F5", "👨‍👩‍👧"),
        ("Lent", "expense", "#6D4C41", "🤝"),
        ("Fuel", "expense", "#FFB300", "⛽"),
        ("Healthcare", "expense", "#EF5350", "🏥"),
        ("Home", "expense", "#26A69A", "🏡"),
        ("Loan", "expense", "#3949AB", "💳"),
        ("Car", "expense", "#546E7A", "🚘"),
        ("Wedding", "expense", "#D81B60", "💍"),
        ("Trip", "expense", "#00897B", "🧳"),
        ("Travel", "expense", "#00ACC1", "✈️"),
        ("Investment", "expense", "#43A047", "📊"),
        ("Others", "expense", "#90A4AE", "📦"),
        ("HomeItems", "expense", "#26C6DA", "🪑"),
        ("Rent", "expense", "#5E35B1", "🏠"),
        ("Return", "expense", "#00897B", "↩️"),
        # Income categories
        ("Salary", "income", "#4CAF50", "💰"),
        ("Freelance", "income", "#8BC34A", "💻"),
        ("Investment", "income", "#CDDC39", "📈"),
        ("Gift", "income", "#FF9800", "🎁"),
        ("Other Income", "income", "#009688", "💵"),
        ("Gifts", "income", "#F9A825", "🎁"),
        ("Other", "income", "#26A69A", "💵"),
        ("Loan", "income", "#5C6BC0", "💳"),
        ("Deal Doctor", "income", "#AB47BC", "🧾"),
        ("Lent", "income", "#8D6E63", "🤝"),
        ("Extra Income", "income", "#66BB6A", "➕"),
        ("DAD", "income", "#42A5F5", "👨"),
        ("Shopping", "income", "#29B6F6", "🛍️"),
        ("Transport", "income", "#26C6DA", "🚕"),
        ("Transfer", "income", "#7E57C2", "🔁"),
        ("Stocks", "income", "#66BB6A", "📈"),
        ("Trip", "income", "#26A69A", "✈️"),
        ("Cashback", "income", "#EF5350", "💸"),
        ("Others", "income", "#78909C", "📦"),
        ("Bills & Fees", "income", "#8E24AA", "🧾"),
        ("TaxReturns", "income", "#43A047", "🧮"),
        ("Return", "income", "#00897B", "↩️"),
        ("BankInterest", "income", "#3949AB", "🏦"),
    ]

    # Keep seeding idempotent for existing databases.
    existing = {(c.name, c.type) for c in Category.query.all()}
    added = False
    for name, cat_type, color, icon in defaults:
        if (name, cat_type) in existing:
            continue
        db.session.add(Category(name=name, type=cat_type, color=color, icon=icon))
        added = True

    if added:
        db.session.commit()
