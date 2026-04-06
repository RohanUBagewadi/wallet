import csv
import io
from datetime import date, datetime
from flask import Blueprint, request, jsonify, make_response
from flask_login import login_required, current_user
from app import db
from app.models import Transaction, Wallet, Category, Budget, Label, Transfer, SUPPORTED_CURRENCIES, transaction_labels
from sqlalchemy import func, extract

api_bp = Blueprint("api", __name__)


# --- Currencies ---

@api_bp.route("/currencies", methods=["GET"])
@login_required
def get_currencies():
    return jsonify(
        {code: {"symbol": info["symbol"], "name": info["name"]} for code, info in SUPPORTED_CURRENCIES.items()}
    )


# --- Transactions ---

@api_bp.route("/transactions", methods=["GET"])
@login_required
def get_transactions():
    wallet_id = request.args.get("wallet_id", type=int)
    category_id = request.args.get("category_id", type=int)
    tx_type = request.args.get("type")
    start = request.args.get("start")
    end = request.args.get("end")

    q = Transaction.query.filter_by(user_id=current_user.id).order_by(Transaction.date.desc(), Transaction.id.desc())

    if wallet_id:
        q = q.filter_by(wallet_id=wallet_id)
    if category_id:
        q = q.filter_by(category_id=category_id)
    if tx_type in ("income", "expense"):
        q = q.filter_by(type=tx_type)
    if start:
        try:
            q = q.filter(Transaction.date >= date.fromisoformat(start))
        except ValueError:
            pass
    if end:
        try:
            q = q.filter(Transaction.date <= date.fromisoformat(end))
        except ValueError:
            pass

    txns = q.all()
    return jsonify([_tx_to_dict(t) for t in txns])


@api_bp.route("/transactions", methods=["POST"])
@login_required
def add_transaction():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid JSON"}), 400

    amount = data.get("amount")
    tx_type = data.get("type")
    wallet_id = data.get("wallet_id")
    category_id = data.get("category_id")

    if not amount or not tx_type or not wallet_id or not category_id:
        return jsonify({"error": "Missing required fields"}), 400

    amount = float(amount)
    if amount <= 0:
        return jsonify({"error": "Amount must be positive"}), 400

    wallet = Wallet.query.filter_by(id=wallet_id, user_id=current_user.id).first()
    if not wallet:
        return jsonify({"error": "Wallet not found"}), 404

    # Exchange rate: 1 unit of wallet currency = X EUR
    # For EUR wallets, rate is always 1
    if wallet.currency == "EUR":
        exchange_rate = 1.0
        amount_eur = amount
    else:
        exchange_rate = float(data.get("exchange_rate", 1.0))
        if exchange_rate <= 0:
            exchange_rate = 1.0
        amount_eur = amount * exchange_rate

    tx = Transaction(
        amount=amount,
        amount_eur=amount_eur,
        exchange_rate=exchange_rate,
        type=tx_type,
        note=data.get("note", ""),
        date=date.fromisoformat(data["date"]) if data.get("date") else date.today(),
        user_id=current_user.id,
        wallet_id=wallet_id,
        category_id=category_id,
    )
    db.session.add(tx)
    db.session.flush()

    label_ids = data.get("label_ids", [])
    if label_ids:
        lbl_objs = Label.query.filter(Label.id.in_(label_ids), Label.user_id == current_user.id).all()
        tx.labels = lbl_objs

    if tx_type == "income":
        wallet.balance += amount
    else:
        wallet.balance -= amount

    db.session.commit()
    return jsonify(_tx_to_dict(tx)), 201


@api_bp.route("/transactions/<int:tx_id>", methods=["PUT"])
@login_required
def update_transaction(tx_id):
    tx = Transaction.query.filter_by(id=tx_id, user_id=current_user.id).first()
    if not tx:
        return jsonify({"error": "Not found"}), 404

    data = request.get_json()
    old_wallet = Wallet.query.get(tx.wallet_id)

    # Reverse old effect
    if tx.type == "income":
        old_wallet.balance -= tx.amount
    else:
        old_wallet.balance += tx.amount

    tx.amount = float(data.get("amount", tx.amount))
    tx.type = data.get("type", tx.type)
    tx.note = data.get("note", tx.note)
    tx.category_id = data.get("category_id", tx.category_id)
    if data.get("date"):
        tx.date = date.fromisoformat(data["date"])
    if data.get("wallet_id"):
        tx.wallet_id = data["wallet_id"]

    new_wallet = Wallet.query.get(tx.wallet_id)
    if new_wallet.currency == "EUR":
        tx.exchange_rate = 1.0
        tx.amount_eur = tx.amount
    else:
        tx.exchange_rate = float(data.get("exchange_rate", tx.exchange_rate))
        tx.amount_eur = tx.amount * tx.exchange_rate

    if "label_ids" in data:
        lbl_objs = Label.query.filter(Label.id.in_(data["label_ids"]), Label.user_id == current_user.id).all()
        tx.labels = lbl_objs

    if tx.type == "income":
        new_wallet.balance += tx.amount
    else:
        new_wallet.balance -= tx.amount

    db.session.commit()
    return jsonify(_tx_to_dict(tx))


@api_bp.route("/transactions/<int:tx_id>", methods=["DELETE"])
@login_required
def delete_transaction(tx_id):
    tx = Transaction.query.filter_by(id=tx_id, user_id=current_user.id).first()
    if not tx:
        return jsonify({"error": "Not found"}), 404

    wallet = Wallet.query.get(tx.wallet_id)
    if tx.type == "income":
        wallet.balance -= tx.amount
    else:
        wallet.balance += tx.amount

    db.session.delete(tx)
    db.session.commit()
    return jsonify({"success": True})


# --- Labels ---

@api_bp.route("/labels", methods=["GET"])
@login_required
def get_labels():
    labels = Label.query.filter_by(user_id=current_user.id).all()
    return jsonify([{"id": l.id, "name": l.name, "color": l.color} for l in labels])


@api_bp.route("/labels", methods=["POST"])
@login_required
def add_label():
    data = request.get_json()
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Name required"}), 400
    label = Label(name=name, color=data.get("color", "#607D8B"), user_id=current_user.id)
    db.session.add(label)
    db.session.commit()
    return jsonify({"id": label.id, "name": label.name, "color": label.color}), 201


@api_bp.route("/labels/<int:lid>", methods=["DELETE"])
@login_required
def delete_label(lid):
    label = Label.query.filter_by(id=lid, user_id=current_user.id).first()
    if not label:
        return jsonify({"error": "Not found"}), 404
    db.session.delete(label)
    db.session.commit()
    return jsonify({"success": True})


# --- CSV Export ---

@api_bp.route("/transactions/export", methods=["GET"])
@login_required
def export_csv():
    txns = Transaction.query.filter_by(user_id=current_user.id).order_by(Transaction.date.desc()).all()

    si = io.StringIO()
    writer = csv.writer(si)
    writer.writerow(["Date", "Type", "Amount", "Currency", "Amount (EUR)", "Exchange Rate",
                      "Category", "Wallet", "Note"])
    for t in txns:
        writer.writerow([
            t.date.isoformat(),
            t.type,
            t.amount,
            t.wallet.currency if t.wallet else "EUR",
            round(t.amount_eur, 2),
            t.exchange_rate,
            t.category.name if t.category else "",
            t.wallet.name if t.wallet else "",
            t.note,
        ])

    output = make_response(si.getvalue())
    output.headers["Content-Disposition"] = "attachment; filename=transactions.csv"
    output.headers["Content-Type"] = "text/csv"
    return output


# --- CSV Import ---

@api_bp.route("/transactions/import", methods=["POST"])
@login_required
def import_csv():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    if not file.filename or not file.filename.endswith(".csv"):
        return jsonify({"error": "File must be a .csv"}), 400

    stream = io.StringIO(file.stream.read().decode("utf-8-sig"))
    reader = csv.DictReader(stream)

    # Preload lookups
    wallets = {w.name.lower(): w for w in Wallet.query.filter_by(user_id=current_user.id).all()}
    categories = {c.name.lower(): c for c in Category.query.all()}

    imported = 0
    errors = []
    for i, row in enumerate(reader, start=2):
        try:
            tx_date = date.fromisoformat(row.get("Date", "").strip())
            tx_type = row.get("Type", "").strip().lower()
            amount = float(row.get("Amount", 0))
            note = row.get("Note", "").strip()

            if tx_type not in ("income", "expense"):
                errors.append(f"Row {i}: Invalid type '{tx_type}'")
                continue
            if amount <= 0:
                errors.append(f"Row {i}: Amount must be positive")
                continue

            # Match wallet by name (case-insensitive)
            wallet_name = row.get("Wallet", "").strip().lower()
            wallet = wallets.get(wallet_name)
            if not wallet:
                wallet = list(wallets.values())[0] if wallets else None
            if not wallet:
                errors.append(f"Row {i}: No wallet found")
                continue

            # Match category
            cat_name = row.get("Category", "").strip().lower()
            cat = categories.get(cat_name)
            if not cat:
                cat = next((c for k, c in categories.items() if cat_name in k or k in cat_name), None)
            if not cat:
                cat = categories.get("other") or list(categories.values())[0]

            exchange_rate = float(row.get("Exchange Rate", 1.0) or 1.0)
            amount_eur_csv = row.get("Amount (EUR)", "").strip()
            if amount_eur_csv:
                amount_eur = float(amount_eur_csv)
            elif wallet.currency == "EUR":
                amount_eur = amount
            else:
                amount_eur = amount * exchange_rate

            tx = Transaction(
                amount=amount,
                amount_eur=amount_eur,
                exchange_rate=exchange_rate,
                type=tx_type,
                note=note[:200],
                date=tx_date,
                user_id=current_user.id,
                wallet_id=wallet.id,
                category_id=cat.id,
            )
            db.session.add(tx)

            if tx_type == "income":
                wallet.balance += amount
            else:
                wallet.balance -= amount

            imported += 1
        except Exception as e:
            errors.append(f"Row {i}: {str(e)}")

    db.session.commit()
    return jsonify({"imported": imported, "errors": errors})


# --- Wallets ---

@api_bp.route("/wallets", methods=["GET"])
@login_required
def get_wallets():
    wallets = Wallet.query.filter_by(user_id=current_user.id).all()
    return jsonify([_wallet_to_dict(w) for w in wallets])


@api_bp.route("/wallets", methods=["POST"])
@login_required
def add_wallet():
    data = request.get_json()
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Name required"}), 400

    currency = data.get("currency", "EUR").upper()
    if currency not in SUPPORTED_CURRENCIES:
        return jsonify({"error": f"Unsupported currency. Use: {', '.join(SUPPORTED_CURRENCIES.keys())}"}), 400

    is_loan = bool(data.get("is_loan", False))
    loan_outstanding = float(data["loan_outstanding"]) if data.get("loan_outstanding") not in (None, "") else None
    w = Wallet(
        name=name,
        balance=loan_outstanding if (is_loan and loan_outstanding is not None) else float(data.get("balance", 0)),
        currency=currency,
        color=data.get("color", "#4CAF50"),
        icon=data.get("icon", "💳"),
        user_id=current_user.id,
        is_loan=is_loan,
        loan_outstanding=loan_outstanding,
        loan_roi=float(data["loan_roi"]) if data.get("loan_roi") not in (None, "") else None,
        loan_tenure=int(data["loan_tenure"]) if data.get("loan_tenure") not in (None, "", 0) else None,
        loan_counterparty=data.get("loan_counterparty", ""),
        loan_note=data.get("loan_note", ""),
    )
    db.session.add(w)
    db.session.commit()
    return jsonify(_wallet_to_dict(w)), 201


@api_bp.route("/wallets/<int:wid>", methods=["PUT"])
@login_required
def update_wallet(wid):
    w = Wallet.query.filter_by(id=wid, user_id=current_user.id).first()
    if not w:
        return jsonify({"error": "Not found"}), 404
    data = request.get_json()
    w.name = data.get("name", w.name)
    w.color = data.get("color", w.color)
    w.icon = data.get("icon", w.icon)
    if "currency" in data:
        currency = data["currency"].upper()
        if currency in SUPPORTED_CURRENCIES:
            w.currency = currency
    if "balance" in data:
        w.balance = float(data["balance"])
    if "is_loan" in data:
        w.is_loan = bool(data["is_loan"])
    if "loan_outstanding" in data:
        w.loan_outstanding = float(data["loan_outstanding"]) if data["loan_outstanding"] not in (None, "") else None
    if "loan_roi" in data:
        w.loan_roi = float(data["loan_roi"]) if data["loan_roi"] not in (None, "") else None
    if "loan_tenure" in data:
        w.loan_tenure = int(data["loan_tenure"]) if data["loan_tenure"] not in (None, "", 0) else None
    if "loan_counterparty" in data:
        w.loan_counterparty = data["loan_counterparty"]
    if "loan_note" in data:
        w.loan_note = data["loan_note"]
    db.session.commit()
    return jsonify(_wallet_to_dict(w))


@api_bp.route("/wallets/<int:wid>", methods=["DELETE"])
@login_required
def delete_wallet(wid):
    w = Wallet.query.filter_by(id=wid, user_id=current_user.id).first()
    if not w:
        return jsonify({"error": "Not found"}), 404
    db.session.delete(w)
    db.session.commit()
    return jsonify({"success": True})


# --- Transfers ---

@api_bp.route("/transfers", methods=["GET"])
@login_required
def get_transfers():
    transfers = Transfer.query.filter_by(user_id=current_user.id).order_by(Transfer.date.desc(), Transfer.id.desc()).all()
    return jsonify([_transfer_to_dict(t) for t in transfers])


@api_bp.route("/transfers", methods=["POST"])
@login_required
def add_transfer():
    data = request.get_json()
    from_wallet_id = data.get("from_wallet_id")
    to_wallet_id = data.get("to_wallet_id")
    from_amount = data.get("from_amount")

    if not from_wallet_id or not to_wallet_id or not from_amount:
        return jsonify({"error": "Missing required fields"}), 400
    if from_wallet_id == to_wallet_id:
        return jsonify({"error": "Cannot transfer to the same wallet"}), 400

    from_amount = float(from_amount)
    if from_amount <= 0:
        return jsonify({"error": "Amount must be positive"}), 400

    from_wallet = Wallet.query.filter_by(id=from_wallet_id, user_id=current_user.id).first()
    to_wallet = Wallet.query.filter_by(id=to_wallet_id, user_id=current_user.id).first()
    if not from_wallet or not to_wallet:
        return jsonify({"error": "Wallet not found"}), 404

    if from_wallet.currency == to_wallet.currency:
        exchange_rate = 1.0
        to_amount = from_amount
    else:
        exchange_rate = float(data.get("exchange_rate", 1.0))
        if exchange_rate <= 0:
            exchange_rate = 1.0
        to_amount = round(from_amount * exchange_rate, 6)

    transfer = Transfer(
        from_wallet_id=from_wallet_id,
        to_wallet_id=to_wallet_id,
        from_amount=from_amount,
        to_amount=to_amount,
        exchange_rate=exchange_rate,
        note=data.get("note", ""),
        date=date.fromisoformat(data["date"]) if data.get("date") else date.today(),
        user_id=current_user.id,
    )
    db.session.add(transfer)
    from_wallet.balance -= from_amount
    if to_wallet.is_loan:
        to_wallet.balance -= to_amount  # EMI payment reduces outstanding debt
    else:
        to_wallet.balance += to_amount
    db.session.commit()
    return jsonify(_transfer_to_dict(transfer)), 201


@api_bp.route("/transfers/<int:tid>", methods=["DELETE"])
@login_required
def delete_transfer(tid):
    transfer = Transfer.query.filter_by(id=tid, user_id=current_user.id).first()
    if not transfer:
        return jsonify({"error": "Not found"}), 404
    from_wallet = Wallet.query.get(transfer.from_wallet_id)
    to_wallet = Wallet.query.get(transfer.to_wallet_id)
    if from_wallet:
        from_wallet.balance += transfer.from_amount
    if to_wallet:
        if to_wallet.is_loan:
            to_wallet.balance += transfer.to_amount  # restore outstanding
        else:
            to_wallet.balance -= transfer.to_amount
    db.session.delete(transfer)
    db.session.commit()
    return jsonify({"success": True})


# --- Categories ---

@api_bp.route("/categories", methods=["GET"])
@login_required
def get_categories():
    cats = Category.query.all()
    return jsonify([{"id": c.id, "name": c.name, "type": c.type, "color": c.color, "icon": c.icon} for c in cats])


# --- Budgets (amounts in EUR) ---

@api_bp.route("/budgets", methods=["GET"])
@login_required
def get_budgets():
    month = request.args.get("month", type=int, default=date.today().month)
    year = request.args.get("year", type=int, default=date.today().year)

    budgets = Budget.query.filter_by(user_id=current_user.id, month=month, year=year).all()
    result = []
    for b in budgets:
        if b.category is None:
            continue
        spent = db.session.query(func.coalesce(func.sum(Transaction.amount_eur), 0)).filter(
            Transaction.user_id == current_user.id,
            Transaction.category_id == b.category_id,
            Transaction.type == "expense",
            extract("month", Transaction.date) == month,
            extract("year", Transaction.date) == year,
        ).scalar()
        result.append({
            "id": b.id,
            "amount": b.amount,
            "spent": float(spent),
            "month": b.month,
            "year": b.year,
            "category": {"id": b.category.id, "name": b.category.name, "icon": b.category.icon, "color": b.category.color},
        })
    return jsonify(result)


@api_bp.route("/budgets", methods=["POST"])
@login_required
def add_budget():
    data = request.get_json()
    cat_id = data.get("category_id")
    if not cat_id:
        return jsonify({"error": "category_id is required"}), 400
    b = Budget(
        amount=float(data["amount"]),
        month=data.get("month", date.today().month),
        year=data.get("year", date.today().year),
        user_id=current_user.id,
        category_id=cat_id,
    )
    db.session.add(b)
    db.session.commit()
    return jsonify({"id": b.id, "amount": b.amount, "month": b.month, "year": b.year}), 201


@api_bp.route("/budgets/<int:bid>", methods=["PUT"])
@login_required
def update_budget(bid):
    b = Budget.query.filter_by(id=bid, user_id=current_user.id).first()
    if not b:
        return jsonify({"error": "Not found"}), 404
    data = request.get_json()
    if "amount" in data:
        b.amount = float(data["amount"])
    db.session.commit()
    return jsonify({"id": b.id, "amount": b.amount})


@api_bp.route("/budgets/<int:bid>", methods=["DELETE"])
@login_required
def delete_budget(bid):
    b = Budget.query.filter_by(id=bid, user_id=current_user.id).first()
    if not b:
        return jsonify({"error": "Not found"}), 404
    db.session.delete(b)
    db.session.commit()
    return jsonify({"success": True})


# --- Dashboard Stats ---

@api_bp.route("/stats", methods=["GET"])
@login_required
def get_stats():
    month = request.args.get("month", type=int, default=date.today().month)
    year = request.args.get("year", type=int, default=date.today().year)

    income = db.session.query(func.coalesce(func.sum(Transaction.amount_eur), 0)).filter(
        Transaction.user_id == current_user.id,
        Transaction.type == "income",
        extract("month", Transaction.date) == month,
        extract("year", Transaction.date) == year,
    ).scalar()

    expense = db.session.query(func.coalesce(func.sum(Transaction.amount_eur), 0)).filter(
        Transaction.user_id == current_user.id,
        Transaction.type == "expense",
        extract("month", Transaction.date) == month,
        extract("year", Transaction.date) == year,
    ).scalar()

    by_category = db.session.query(
        Category.name, Category.color, Category.icon,
        func.sum(Transaction.amount_eur).label("total")
    ).join(Transaction).filter(
        Transaction.user_id == current_user.id,
        Transaction.type == "expense",
        extract("month", Transaction.date) == month,
        extract("year", Transaction.date) == year,
    ).group_by(Category.id).all()

    daily = db.session.query(
        Transaction.date, func.sum(Transaction.amount_eur)
    ).filter(
        Transaction.user_id == current_user.id,
        Transaction.type == "expense",
        extract("month", Transaction.date) == month,
        extract("year", Transaction.date) == year,
    ).group_by(Transaction.date).order_by(Transaction.date).all()

    wallets = Wallet.query.filter_by(user_id=current_user.id).all()

    def _est_eur(w):
        if w.currency == "EUR":
            return w.balance
        last_tx = Transaction.query.filter_by(wallet_id=w.id).order_by(Transaction.created_at.desc()).first()
        rate = last_tx.exchange_rate if last_tx and last_tx.exchange_rate > 0 else 1.0
        return round(w.balance * rate, 2)

    wallet_data = [
        {
            "name": w.name, "balance": w.balance, "currency": w.currency,
            "symbol": SUPPORTED_CURRENCIES.get(w.currency, {}).get("symbol", "€"),
            "balance_eur": _est_eur(w), "color": w.color, "icon": w.icon,
        }
        for w in wallets
    ]
    total_balance_eur = round(sum(d["balance_eur"] for d in wallet_data), 2)

    return jsonify({
        "income": float(income),
        "expense": float(expense),
        "net_savings": float(income) - float(expense),
        "total_balance_eur": total_balance_eur,
        "by_category": [{"name": c[0], "color": c[1], "icon": c[2], "total": float(c[3])} for c in by_category],
        "daily": [{"date": d[0].isoformat(), "amount": float(d[1])} for d in daily],
        "wallets_summary": wallet_data,
    })


# --- Analytics ---

@api_bp.route("/analytics", methods=["GET"])
@login_required
def get_analytics():
    year = request.args.get("year", type=int, default=date.today().year)

    # Monthly income + expense
    monthly = []
    for m in range(1, 13):
        inc = db.session.query(func.coalesce(func.sum(Transaction.amount_eur), 0)).filter(
            Transaction.user_id == current_user.id, Transaction.type == "income",
            extract("year", Transaction.date) == year, extract("month", Transaction.date) == m,
        ).scalar()
        exp = db.session.query(func.coalesce(func.sum(Transaction.amount_eur), 0)).filter(
            Transaction.user_id == current_user.id, Transaction.type == "expense",
            extract("year", Transaction.date) == year, extract("month", Transaction.date) == m,
        ).scalar()
        monthly.append({"month": m, "income": float(inc), "expense": float(exp)})

    # By category (expense)
    cat_expense = db.session.query(
        Category.id, Category.name, Category.color, Category.icon,
        func.coalesce(func.sum(Transaction.amount_eur), 0).label("total"),
        func.count(Transaction.id).label("cnt"),
    ).outerjoin(Transaction, (Transaction.category_id == Category.id) & (Transaction.user_id == current_user.id)
                & (Transaction.type == "expense") & (extract("year", Transaction.date) == year)
    ).group_by(Category.id).order_by(func.sum(Transaction.amount_eur).desc()).all()

    # By category (income)
    cat_income = db.session.query(
        Category.id, Category.name, Category.color, Category.icon,
        func.coalesce(func.sum(Transaction.amount_eur), 0).label("total"),
        func.count(Transaction.id).label("cnt"),
    ).outerjoin(Transaction, (Transaction.category_id == Category.id) & (Transaction.user_id == current_user.id)
                & (Transaction.type == "income") & (extract("year", Transaction.date) == year)
    ).group_by(Category.id).order_by(func.sum(Transaction.amount_eur).desc()).all()

    # By label
    labels = Label.query.filter_by(user_id=current_user.id).all()
    label_stats = []
    for lbl in labels:
        exp = db.session.query(func.coalesce(func.sum(Transaction.amount_eur), 0)).join(
            transaction_labels, Transaction.id == transaction_labels.c.transaction_id
        ).filter(
            Transaction.user_id == current_user.id, Transaction.type == "expense",
            transaction_labels.c.label_id == lbl.id, extract("year", Transaction.date) == year,
        ).scalar()
        inc = db.session.query(func.coalesce(func.sum(Transaction.amount_eur), 0)).join(
            transaction_labels, Transaction.id == transaction_labels.c.transaction_id
        ).filter(
            Transaction.user_id == current_user.id, Transaction.type == "income",
            transaction_labels.c.label_id == lbl.id, extract("year", Transaction.date) == year,
        ).scalar()
        cnt = db.session.query(func.count(Transaction.id)).join(
            transaction_labels, Transaction.id == transaction_labels.c.transaction_id
        ).filter(
            Transaction.user_id == current_user.id, transaction_labels.c.label_id == lbl.id,
            extract("year", Transaction.date) == year,
        ).scalar()
        label_stats.append({
            "id": lbl.id, "name": lbl.name, "color": lbl.color,
            "total_expense": float(exp), "total_income": float(inc), "count": cnt,
        })

    return jsonify({
        "year": year,
        "monthly": monthly,
        "by_category_expense": [
            {"id": c[0], "name": c[1], "color": c[2], "icon": c[3], "total": float(c[4]), "count": c[5]}
            for c in cat_expense if float(c[4]) > 0
        ],
        "by_category_income": [
            {"id": c[0], "name": c[1], "color": c[2], "icon": c[3], "total": float(c[4]), "count": c[5]}
            for c in cat_income if float(c[4]) > 0
        ],
        "by_label": [l for l in label_stats if l["total_expense"] > 0 or l["total_income"] > 0 or l["count"] > 0],
    })


# --- Loans ---

@api_bp.route("/loans", methods=["GET"])
@login_required
def get_loans():
    wallets = Wallet.query.filter_by(user_id=current_user.id, is_loan=True).all()

    def _est_eur(w):
        if w.currency == "EUR":
            return w.balance
        last_tx = Transaction.query.filter_by(wallet_id=w.id).order_by(Transaction.created_at.desc()).first()
        rate = last_tx.exchange_rate if last_tx and last_tx.exchange_rate > 0 else 1.0
        return round(w.balance * rate, 2)

    result = []
    for w in wallets:
        d = _wallet_to_dict(w)
        d["balance_eur"] = _est_eur(w)
        principal = w.loan_outstanding or w.balance
        if w.loan_roi and w.loan_tenure and principal:
            r = w.loan_roi / 12 / 100
            n = w.loan_tenure
            emi = principal * r * (1 + r) ** n / ((1 + r) ** n - 1) if r > 0 else principal / n
            d["emi"] = round(emi, 2)
        else:
            d["emi"] = None
        d["paid_amount"] = round(max(0, (w.loan_outstanding or 0) - w.balance), 2)
        result.append(d)
    return jsonify(result)


# --- Helpers ---

def _tx_to_dict(t):
    wallet_currency = t.wallet.currency if t.wallet else "EUR"
    symbol = SUPPORTED_CURRENCIES.get(wallet_currency, {}).get("symbol", "€")
    return {
        "id": t.id,
        "amount": t.amount,
        "amount_eur": round(t.amount_eur, 2),
        "exchange_rate": t.exchange_rate,
        "currency": wallet_currency,
        "symbol": symbol,
        "type": t.type,
        "note": t.note,
        "date": t.date.isoformat(),
        "wallet_id": t.wallet_id,
        "wallet_name": t.wallet.name if t.wallet else "",
        "category_id": t.category_id,
        "category_name": t.category.name if t.category else "",
        "category_icon": t.category.icon if t.category else "",
        "category_color": t.category.color if t.category else "",
        "labels": [{"id": l.id, "name": l.name, "color": l.color} for l in t.labels],
        "is_transfer": False,
    }


def _transfer_to_dict(t):
    from_sym = SUPPORTED_CURRENCIES.get(t.from_wallet.currency if t.from_wallet else "EUR", {}).get("symbol", "€")
    to_sym = SUPPORTED_CURRENCIES.get(t.to_wallet.currency if t.to_wallet else "EUR", {}).get("symbol", "€")
    return {
        "id": t.id,
        "from_wallet_id": t.from_wallet_id,
        "to_wallet_id": t.to_wallet_id,
        "from_wallet_name": t.from_wallet.name if t.from_wallet else "",
        "to_wallet_name": t.to_wallet.name if t.to_wallet else "",
        "from_currency": t.from_wallet.currency if t.from_wallet else "EUR",
        "to_currency": t.to_wallet.currency if t.to_wallet else "EUR",
        "from_symbol": from_sym,
        "to_symbol": to_sym,
        "from_amount": t.from_amount,
        "to_amount": t.to_amount,
        "exchange_rate": t.exchange_rate,
        "note": t.note,
        "date": t.date.isoformat(),
        "is_transfer": True,
    }


def _wallet_to_dict(w):
    symbol = SUPPORTED_CURRENCIES.get(w.currency, {}).get("symbol", "€")
    return {
        "id": w.id,
        "name": w.name,
        "balance": w.balance,
        "currency": w.currency,
        "symbol": symbol,
        "color": w.color,
        "icon": w.icon,
        "is_loan": bool(w.is_loan),
        "loan_outstanding": w.loan_outstanding,
        "loan_roi": w.loan_roi,
        "loan_tenure": w.loan_tenure,
        "loan_counterparty": w.loan_counterparty or "",
        "loan_note": w.loan_note or "",
    }
