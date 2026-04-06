from flask import Blueprint, render_template
from flask_login import login_required, current_user

main_bp = Blueprint("main", __name__)


@main_bp.route("/")
def index():
    if current_user.is_authenticated:
        from flask import redirect, url_for
        return redirect(url_for("main.dashboard"))
    return render_template("landing.html")


@main_bp.route("/dashboard")
@login_required
def dashboard():
    return render_template("dashboard.html")


@main_bp.route("/transactions")
@login_required
def transactions():
    return render_template("transactions.html")


@main_bp.route("/budgets")
@login_required
def budgets():
    return render_template("budgets.html")


@main_bp.route("/wallets")
@login_required
def wallets():
    return render_template("wallets.html")


@main_bp.route("/statistics")
@login_required
def statistics():
    return render_template("statistics.html")


@main_bp.route("/loans")
@login_required
def loans():
    return render_template("loans.html")


@main_bp.route("/wallet/<int:wallet_id>")
@login_required
def wallet_transactions(wallet_id):
    return render_template("wallet_transactions.html", wallet_id=wallet_id)
