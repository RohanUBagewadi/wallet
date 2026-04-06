from datetime import datetime, date
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import UserMixin
from app import db


SUPPORTED_CURRENCIES = {
    "EUR": {"symbol": "€", "name": "Euro"},
    "USD": {"symbol": "$", "name": "US Dollar"},
    "INR": {"symbol": "₹", "name": "Indian Rupee"},
    "AUD": {"symbol": "A$", "name": "Australian Dollar"},
    "GBP": {"symbol": "£", "name": "British Pound"},
}


class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    base_currency = db.Column(db.String(3), default="EUR")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    wallets = db.relationship("Wallet", backref="owner", lazy=True, cascade="all, delete-orphan")
    transactions = db.relationship("Transaction", backref="owner", lazy=True, cascade="all, delete-orphan")
    budgets = db.relationship("Budget", backref="owner", lazy=True, cascade="all, delete-orphan")

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Wallet(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    balance = db.Column(db.Float, default=0.0)
    currency = db.Column(db.String(3), default="EUR")
    color = db.Column(db.String(7), default="#4CAF50")
    icon = db.Column(db.String(10), default="💳")
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    # Loan fields
    is_loan = db.Column(db.Boolean, default=False)
    loan_outstanding = db.Column(db.Float, nullable=True)   # original principal
    loan_roi = db.Column(db.Float, nullable=True)           # annual interest rate %
    loan_tenure = db.Column(db.Integer, nullable=True)      # tenure in months
    loan_counterparty = db.Column(db.String(100), default="")
    loan_note = db.Column(db.String(200), default="")

    transactions = db.relationship("Transaction", backref="wallet", lazy=True, cascade="all, delete-orphan")


class Category(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)
    type = db.Column(db.String(10), nullable=False)  # 'income' or 'expense'
    color = db.Column(db.String(7), default="#607D8B")
    icon = db.Column(db.String(10), default="📦")

    transactions = db.relationship("Transaction", backref="category", lazy=True)


class Label(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)
    color = db.Column(db.String(7), default="#607D8B")
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)


transaction_labels = db.Table(
    "transaction_labels",
    db.Column("transaction_id", db.Integer, db.ForeignKey("transaction.id"), primary_key=True),
    db.Column("label_id", db.Integer, db.ForeignKey("label.id"), primary_key=True),
)


class Transaction(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    amount = db.Column(db.Float, nullable=False)  # amount in wallet's currency
    amount_eur = db.Column(db.Float, nullable=False)  # amount converted to EUR (base)
    exchange_rate = db.Column(db.Float, default=1.0)  # rate: 1 wallet_currency = X EUR
    type = db.Column(db.String(10), nullable=False)  # 'income' or 'expense'
    note = db.Column(db.String(200), default="")
    date = db.Column(db.Date, nullable=False, default=date.today)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    wallet_id = db.Column(db.Integer, db.ForeignKey("wallet.id"), nullable=False)
    category_id = db.Column(db.Integer, db.ForeignKey("category.id"), nullable=False)
    labels = db.relationship("Label", secondary=transaction_labels, lazy="subquery",
                             backref=db.backref("transactions", lazy=True))


class Budget(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    amount = db.Column(db.Float, nullable=False)
    month = db.Column(db.Integer, nullable=False)  # 1-12
    year = db.Column(db.Integer, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    category_id = db.Column(db.Integer, db.ForeignKey("category.id"), nullable=False)
    category = db.relationship("Category")


class Transfer(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    from_wallet_id = db.Column(db.Integer, db.ForeignKey("wallet.id"), nullable=False)
    to_wallet_id = db.Column(db.Integer, db.ForeignKey("wallet.id"), nullable=False)
    from_amount = db.Column(db.Float, nullable=False)
    to_amount = db.Column(db.Float, nullable=False)
    exchange_rate = db.Column(db.Float, default=1.0)  # 1 from_currency = X to_currency
    note = db.Column(db.String(200), default="")
    date = db.Column(db.Date, nullable=False, default=date.today)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)

    from_wallet = db.relationship("Wallet", foreign_keys=[from_wallet_id])
    to_wallet = db.relationship("Wallet", foreign_keys=[to_wallet_id])
