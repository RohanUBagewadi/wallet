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

    if Category.query.first() is None:
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
            # Income categories
            ("Salary", "income", "#4CAF50", "💰"),
            ("Freelance", "income", "#8BC34A", "💻"),
            ("Investment", "income", "#CDDC39", "📈"),
            ("Gift", "income", "#FF9800", "🎁"),
            ("Other Income", "income", "#009688", "💵"),
        ]
        for name, cat_type, color, icon in defaults:
            db.session.add(
                Category(name=name, type=cat_type, color=color, icon=icon)
            )
        db.session.commit()
