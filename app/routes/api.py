import csv
import io
from datetime import date, datetime
from flask import Blueprint, request, jsonify, make_response
from flask_login import login_required, current_user
from app import db
from app.models import Transaction, Wallet, Category, Budget, Label, Transfer, RecurringTransaction, SUPPORTED_CURRENCIES, transaction_labels
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
    label_id = request.args.get("label_id", type=int)
    tx_type = request.args.get("type")
    start = request.args.get("start")
    end = request.args.get("end")

    q = Transaction.query.filter_by(user_id=current_user.id).order_by(Transaction.date.desc(), Transaction.id.desc())

    if wallet_id:
        q = q.filter_by(wallet_id=wallet_id)
    if category_id:
        q = q.filter_by(category_id=category_id)
    if label_id:
        q = q.filter(Transaction.labels.any(Label.id == label_id))
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


@api_bp.route("/transactions/bulk-delete", methods=["POST"])
@login_required
def bulk_delete_transactions():
    data = request.get_json()
    ids = data.get("ids", [])
    if not ids or not isinstance(ids, list):
        return jsonify({"error": "No transaction IDs provided"}), 400

    txns = Transaction.query.filter(
        Transaction.id.in_(ids),
        Transaction.user_id == current_user.id,
    ).all()

    deleted = 0
    for tx in txns:
        wallet = Wallet.query.get(tx.wallet_id)
        if wallet:
            if tx.type == "income":
                wallet.balance -= tx.amount
            else:
                wallet.balance += tx.amount
        db.session.delete(tx)
        deleted += 1

    db.session.commit()
    return jsonify({"deleted": deleted})


# --- Recurring Transactions ---

VALID_FREQUENCIES = ("weekly", "monthly", "3months", "6months", "yearly")


@api_bp.route("/recurring", methods=["GET"])
@login_required
def get_recurring():
    recs = RecurringTransaction.query.filter_by(user_id=current_user.id).order_by(RecurringTransaction.next_date).all()
    return jsonify([_recurring_to_dict(r) for r in recs])


@api_bp.route("/recurring", methods=["POST"])
@login_required
def add_recurring():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid JSON"}), 400

    amount = data.get("amount")
    tx_type = data.get("type")
    wallet_id = data.get("wallet_id")
    category_id = data.get("category_id")
    frequency = data.get("frequency")
    start_date_str = data.get("start_date")

    if not all([amount, tx_type, wallet_id, category_id, frequency, start_date_str]):
        return jsonify({"error": "Missing required fields"}), 400

    if frequency not in VALID_FREQUENCIES:
        return jsonify({"error": f"Invalid frequency. Use: {', '.join(VALID_FREQUENCIES)}"}), 400

    amount = float(amount)
    if amount <= 0:
        return jsonify({"error": "Amount must be positive"}), 400

    wallet = Wallet.query.filter_by(id=wallet_id, user_id=current_user.id).first()
    if not wallet:
        return jsonify({"error": "Wallet not found"}), 404

    exchange_rate = 1.0 if wallet.currency == "EUR" else float(data.get("exchange_rate", 1.0))
    if exchange_rate <= 0:
        exchange_rate = 1.0

    start_date = date.fromisoformat(start_date_str)
    end_date = date.fromisoformat(data["end_date"]) if data.get("end_date") else None

    rec = RecurringTransaction(
        amount=amount,
        exchange_rate=exchange_rate,
        type=tx_type,
        note=data.get("note", ""),
        frequency=frequency,
        start_date=start_date,
        end_date=end_date,
        next_date=start_date,
        active=True,
        user_id=current_user.id,
        wallet_id=wallet_id,
        category_id=category_id,
    )
    db.session.add(rec)
    db.session.commit()
    return jsonify(_recurring_to_dict(rec)), 201


@api_bp.route("/recurring/<int:rid>", methods=["DELETE"])
@login_required
def delete_recurring(rid):
    rec = RecurringTransaction.query.filter_by(id=rid, user_id=current_user.id).first()
    if not rec:
        return jsonify({"error": "Not found"}), 404
    db.session.delete(rec)
    db.session.commit()
    return jsonify({"success": True})


@api_bp.route("/recurring/<int:rid>/toggle", methods=["POST"])
@login_required
def toggle_recurring(rid):
    rec = RecurringTransaction.query.filter_by(id=rid, user_id=current_user.id).first()
    if not rec:
        return jsonify({"error": "Not found"}), 404
    rec.active = not rec.active
    db.session.commit()
    return jsonify(_recurring_to_dict(rec))


def process_recurring_transactions():
    """Create actual transactions for any recurring entries whose next_date <= today."""
    today = date.today()
    due = RecurringTransaction.query.filter(
        RecurringTransaction.active == True,
        RecurringTransaction.next_date <= today,
    ).all()

    for rec in due:
        while rec.active and rec.next_date <= today:
            wallet = Wallet.query.get(rec.wallet_id)
            if not wallet:
                rec.active = False
                break

            amount_eur = rec.amount * rec.exchange_rate if wallet.currency != "EUR" else rec.amount

            tx = Transaction(
                amount=rec.amount,
                amount_eur=amount_eur,
                exchange_rate=rec.exchange_rate,
                type=rec.type,
                note=rec.note,
                date=rec.next_date,
                user_id=rec.user_id,
                wallet_id=rec.wallet_id,
                category_id=rec.category_id,
            )
            db.session.add(tx)

            if rec.type == "income":
                wallet.balance += rec.amount
            else:
                wallet.balance -= rec.amount

            rec.advance_next_date()

    db.session.commit()


# --- Labels ---

@api_bp.route("/labels", methods=["GET"])
@login_required
def get_labels():
    labels = Label.query.filter_by(user_id=current_user.id).order_by(func.lower(Label.name)).all()
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


@api_bp.route("/import/mapped", methods=["POST"])
@login_required
def import_mapped():
    """Import CSV with user-defined column mapping and date format."""
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    if not file.filename or not file.filename.endswith(".csv"):
        return jsonify({"error": "File must be a .csv"}), 400

    # Mapping config sent as form fields
    col_date = request.form.get("col_date", "").strip()
    col_amount = request.form.get("col_amount", "").strip()
    col_type = request.form.get("col_type", "").strip()
    col_category = request.form.get("col_category", "").strip()
    col_wallet = request.form.get("col_wallet", "").strip()
    col_note = request.form.get("col_note", "").strip()
    col_currency = request.form.get("col_currency", "").strip()
    col_exchange_rate = request.form.get("col_exchange_rate", "").strip()
    col_amount_eur = request.form.get("col_amount_eur", "").strip()
    col_labels = request.form.get("col_labels", "").strip()
    date_format = request.form.get("date_format", "%Y-%m-%d").strip()
    default_type = request.form.get("default_type", "").strip().lower()
    default_wallet_id = request.form.get("default_wallet_id", type=int)

    if not col_date or not col_amount:
        return jsonify({"error": "Date and Amount column mappings are required"}), 400

    stream = io.StringIO(file.stream.read().decode("utf-8-sig"))
    reader = csv.DictReader(stream)

    wallets = {w.name.lower(): w for w in Wallet.query.filter_by(user_id=current_user.id).all()}
    wallets_by_id = {w.id: w for w in Wallet.query.filter_by(user_id=current_user.id).all()}
    wallets_by_currency = {}
    for w in wallets.values():
        wallets_by_currency.setdefault(w.currency.upper(), w)
    categories = {c.name.lower(): c for c in Category.query.all()}
    existing_labels = {l.name.lower(): l for l in Label.query.filter_by(user_id=current_user.id).all()}

    default_wallet = wallets_by_id.get(default_wallet_id)
    if not default_wallet and wallets:
        default_wallet = list(wallets.values())[0]

    imported = 0
    errors = []
    for i, row in enumerate(reader, start=2):
        try:
            # --- Date ---
            raw_date = row.get(col_date, "").strip()
            if not raw_date:
                errors.append(f"Row {i}: Empty date")
                continue
            # Strip ISO 8601 time portion (e.g. 2024-02-26T11:00:51+00:00 → 2024-02-26)
            if "T" in raw_date:
                raw_date = raw_date.split("T")[0]
            try:
                tx_date = datetime.strptime(raw_date, date_format).date()
            except ValueError:
                errors.append(f"Row {i}: Cannot parse date '{raw_date}' with format '{date_format}'")
                continue

            # --- Amount ---
            raw_amount = row.get(col_amount, "").strip().replace(",", "")
            if not raw_amount:
                errors.append(f"Row {i}: Empty amount")
                continue
            amount = abs(float(raw_amount))
            if amount == 0:
                errors.append(f"Row {i}: Zero amount")
                continue

            # --- Type ---
            if col_type:
                raw_type = row.get(col_type, "").strip().lower()
                if raw_type in ("income", "credit", "cr", "incoming transfer"):
                    tx_type = "income"
                elif raw_type in ("expense", "debit", "dr", "outgoing transfer"):
                    tx_type = "expense"
                elif "incoming" in raw_type or "credit" in raw_type:
                    tx_type = "income"
                elif "outgoing" in raw_type or "debit" in raw_type:
                    tx_type = "expense"
                else:
                    tx_type = default_type or "expense"
            else:
                # Infer from sign if no type column
                raw_val = row.get(col_amount, "").strip().replace(",", "")
                if raw_val.startswith("-"):
                    tx_type = "expense"
                elif raw_val.startswith("+"):
                    tx_type = "income"
                else:
                    tx_type = default_type or "expense"

            if tx_type not in ("income", "expense"):
                tx_type = "expense"

            # --- Wallet ---
            wallet = default_wallet
            if col_wallet:
                wname = row.get(col_wallet, "").strip().lower()
                if wname and wname in wallets:
                    wallet = wallets[wname]
            # If no wallet matched by name, try matching by currency column
            if wallet == default_wallet and col_currency:
                ccy = row.get(col_currency, "").strip().upper()
                if ccy and ccy in wallets_by_currency:
                    wallet = wallets_by_currency[ccy]
            if not wallet:
                errors.append(f"Row {i}: No wallet found")
                continue

            # --- Category ---
            cat = None
            if col_category:
                cname = row.get(col_category, "").strip().lower()
                cat = categories.get(cname)
                if not cat:
                    cat = next((c for k, c in categories.items() if cname and (cname in k or k in cname)), None)
            if not cat:
                cat = categories.get("others") or categories.get("other") or (list(categories.values())[0] if categories else None)
            if not cat:
                # Create "Others" category on the fly
                other_cat = Category(name="Others", type=tx_type, color="#90A4AE", icon="📦")
                db.session.add(other_cat)
                db.session.flush()
                categories[other_cat.name.lower()] = other_cat
                cat = other_cat

            # --- Note ---
            note = ""
            if col_note:
                note = row.get(col_note, "").strip()[:200]

            # --- Exchange rate & EUR amount ---
            exchange_rate = 1.0
            if col_exchange_rate:
                try:
                    exchange_rate = float(row.get(col_exchange_rate, "1").strip().replace(",", "") or "1")
                except ValueError:
                    exchange_rate = 1.0
            if exchange_rate <= 0:
                exchange_rate = 1.0

            amount_eur = None
            if col_amount_eur:
                try:
                    raw_eur = row.get(col_amount_eur, "").strip().replace(",", "")
                    if raw_eur:
                        amount_eur = abs(float(raw_eur))
                except ValueError:
                    pass

            if amount_eur is None:
                if wallet.currency == "EUR":
                    amount_eur = amount
                else:
                    amount_eur = amount * exchange_rate

            tx = Transaction(
                amount=amount,
                amount_eur=amount_eur,
                exchange_rate=exchange_rate,
                type=tx_type,
                note=note,
                date=tx_date,
                user_id=current_user.id,
                wallet_id=wallet.id,
                category_id=cat.id,
            )
            db.session.add(tx)
            db.session.flush()

            # --- Labels ---
            if col_labels:
                raw_labels = row.get(col_labels, "").strip()
                if raw_labels:
                    label_names = [l.strip() for l in raw_labels.split(",") if l.strip()]
                    lbl_objs = []
                    for lname in label_names:
                        lbl = existing_labels.get(lname.lower())
                        if not lbl:
                            lbl = Label(name=lname, user_id=current_user.id)
                            db.session.add(lbl)
                            db.session.flush()
                            existing_labels[lname.lower()] = lbl
                        lbl_objs.append(lbl)
                    tx.labels = lbl_objs

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
    wallets = Wallet.query.filter_by(user_id=current_user.id).order_by(func.lower(Wallet.name)).all()
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
        is_credit_card=bool(data.get("is_credit_card", False)),
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
    if "is_credit_card" in data:
        w.is_credit_card = bool(data["is_credit_card"])
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
        is_extra_payment=bool(data.get("is_extra_payment", False)),
    )
    db.session.add(transfer)
    from_wallet.balance -= from_amount
    if to_wallet.is_loan:
        to_wallet.balance -= to_amount  # EMI payment reduces outstanding debt
    else:
        to_wallet.balance += to_amount
    db.session.commit()
    return jsonify(_transfer_to_dict(transfer)), 201


@api_bp.route("/transfers/<int:tid>", methods=["PUT"])
@login_required
def update_transfer(tid):
    transfer = Transfer.query.filter_by(id=tid, user_id=current_user.id).first()
    if not transfer:
        return jsonify({"error": "Not found"}), 404

    data = request.get_json()

    # Reverse old wallet balance changes
    old_from = Wallet.query.get(transfer.from_wallet_id)
    old_to = Wallet.query.get(transfer.to_wallet_id)
    if old_from:
        old_from.balance += transfer.from_amount
    if old_to:
        if old_to.is_loan:
            old_to.balance += transfer.to_amount
        else:
            old_to.balance -= transfer.to_amount

    # Update transfer fields
    from_wallet_id = int(data.get("from_wallet_id", transfer.from_wallet_id))
    to_wallet_id = int(data.get("to_wallet_id", transfer.to_wallet_id))
    from_amount = float(data.get("from_amount", transfer.from_amount))

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

    transfer.from_wallet_id = from_wallet_id
    transfer.to_wallet_id = to_wallet_id
    transfer.from_amount = from_amount
    transfer.to_amount = to_amount
    transfer.exchange_rate = exchange_rate
    transfer.note = data.get("note", transfer.note)
    transfer.date = date.fromisoformat(data["date"]) if data.get("date") else transfer.date
    transfer.is_extra_payment = bool(data.get("is_extra_payment", False))

    # Apply new wallet balance changes
    from_wallet.balance -= from_amount
    if to_wallet.is_loan:
        to_wallet.balance -= to_amount
    else:
        to_wallet.balance += to_amount

    db.session.commit()
    return jsonify(_transfer_to_dict(transfer))


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
    cats = Category.query.order_by(Category.type, func.lower(Category.name)).all()
    return jsonify([{"id": c.id, "name": c.name, "type": c.type, "color": c.color, "icon": c.icon} for c in cats])


@api_bp.route("/categories", methods=["POST"])
@login_required
def add_category():
    data = request.get_json()
    name = (data.get("name") or "").strip()
    cat_type = data.get("type", "expense")
    color = data.get("color", "#607D8B")
    icon = data.get("icon", "📦")

    if not name:
        return jsonify({"error": "Name is required"}), 400
    if cat_type not in ("income", "expense"):
        return jsonify({"error": "Type must be income or expense"}), 400

    existing = Category.query.filter_by(name=name, type=cat_type).first()
    if existing:
        return jsonify({"error": f"Category '{name}' already exists for {cat_type}"}), 409

    cat = Category(name=name, type=cat_type, color=color, icon=icon)
    db.session.add(cat)
    db.session.commit()
    return jsonify({"id": cat.id, "name": cat.name, "type": cat.type, "color": cat.color, "icon": cat.icon}), 201


@api_bp.route("/categories/<int:cid>", methods=["DELETE"])
@login_required
def delete_category(cid):
    cat = Category.query.get(cid)
    if not cat:
        return jsonify({"error": "Category not found"}), 404

    # Check if any transactions use this category
    tx_count = Transaction.query.filter_by(category_id=cid).count()
    if tx_count > 0:
        return jsonify({"error": f"Cannot delete: {tx_count} transaction(s) use this category. Reassign them first."}), 409

    db.session.delete(cat)
    db.session.commit()
    return jsonify({"success": True})


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

    # Daily net flows for running-balance chart
    daily_flows_raw = db.session.query(
        Transaction.date,
        Transaction.type,
        func.sum(Transaction.amount_eur).label("total"),
    ).filter(
        Transaction.user_id == current_user.id,
        extract("month", Transaction.date) == month,
        extract("year", Transaction.date) == year,
    ).group_by(Transaction.date, Transaction.type).order_by(Transaction.date).all()

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
            "is_credit_card": bool(getattr(w, 'is_credit_card', False)),
        }
        for w in wallets if not w.is_loan
    ]
    total_balance_eur = round(sum(d["balance_eur"] for d in wallet_data), 2)

    # Build running daily balance + daily income/expense for the selected month
    income_by_date = {}
    expense_by_date = {}
    flows_by_date = {}
    for row in daily_flows_raw:
        d = row[0]
        flows_by_date.setdefault(d, 0.0)
        if row[1] == "income":
            flows_by_date[d] += float(row[2])
            income_by_date[d] = income_by_date.get(d, 0.0) + float(row[2])
        else:
            flows_by_date[d] -= float(row[2])
            expense_by_date[d] = expense_by_date.get(d, 0.0) + float(row[2])

    balance_start = round(total_balance_eur - (float(income) - float(expense)), 2)
    running = balance_start
    daily_balance = [{"date": f"{year}-{str(month).zfill(2)}-01", "balance": balance_start}]
    daily_income_expense = []
    for d in sorted(flows_by_date.keys()):
        running = round(running + flows_by_date[d], 2)
        daily_balance.append({"date": d.isoformat(), "balance": running})
    for d in sorted(set(list(income_by_date.keys()) + list(expense_by_date.keys()))):
        daily_income_expense.append({
            "date": d.isoformat(),
            "income": round(income_by_date.get(d, 0.0), 2),
            "expense": round(expense_by_date.get(d, 0.0), 2),
        })

    return jsonify({
        "income": float(income),
        "expense": float(expense),
        "net_savings": float(income) - float(expense),
        "total_balance_eur": total_balance_eur,
        "by_category": [{"name": c[0], "color": c[1], "icon": c[2], "total": float(c[3])} for c in by_category],
        "daily": [{"date": d[0].isoformat(), "amount": float(d[1])} for d in daily],
        "daily_balance": daily_balance,
        "daily_income_expense": daily_income_expense,
        "wallets_summary": wallet_data,
    })


# --- Analytics ---

@api_bp.route("/analytics", methods=["GET"])
@login_required
def get_analytics():
    year = request.args.get("year", type=int, default=date.today().year)
    month = request.args.get("month", type=int)
    if month is not None and (month < 1 or month > 12):
        month = None

    # Monthly income + expense
    monthly = []
    month_range = [month] if month else range(1, 13)
    for m in month_range:
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
    expense_join_filters = (
        (Transaction.category_id == Category.id)
        & (Transaction.user_id == current_user.id)
        & (Transaction.type == "expense")
        & (extract("year", Transaction.date) == year)
    )
    if month:
        expense_join_filters = expense_join_filters & (extract("month", Transaction.date) == month)

    cat_expense = db.session.query(
        Category.id, Category.name, Category.color, Category.icon,
        func.coalesce(func.sum(Transaction.amount_eur), 0).label("total"),
        func.count(Transaction.id).label("cnt"),
    ).outerjoin(Transaction, expense_join_filters
    ).group_by(Category.id).order_by(func.sum(Transaction.amount_eur).desc()).all()

    # By category (income)
    income_join_filters = (
        (Transaction.category_id == Category.id)
        & (Transaction.user_id == current_user.id)
        & (Transaction.type == "income")
        & (extract("year", Transaction.date) == year)
    )
    if month:
        income_join_filters = income_join_filters & (extract("month", Transaction.date) == month)

    cat_income = db.session.query(
        Category.id, Category.name, Category.color, Category.icon,
        func.coalesce(func.sum(Transaction.amount_eur), 0).label("total"),
        func.count(Transaction.id).label("cnt"),
    ).outerjoin(Transaction, income_join_filters
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
            *( [extract("month", Transaction.date) == month] if month else [] ),
        ).scalar()
        inc = db.session.query(func.coalesce(func.sum(Transaction.amount_eur), 0)).join(
            transaction_labels, Transaction.id == transaction_labels.c.transaction_id
        ).filter(
            Transaction.user_id == current_user.id, Transaction.type == "income",
            transaction_labels.c.label_id == lbl.id, extract("year", Transaction.date) == year,
            *( [extract("month", Transaction.date) == month] if month else [] ),
        ).scalar()
        cnt = db.session.query(func.count(Transaction.id)).join(
            transaction_labels, Transaction.id == transaction_labels.c.transaction_id
        ).filter(
            Transaction.user_id == current_user.id, transaction_labels.c.label_id == lbl.id,
            extract("year", Transaction.date) == year,
            *( [extract("month", Transaction.date) == month] if month else [] ),
        ).scalar()
        label_stats.append({
            "id": lbl.id, "name": lbl.name, "color": lbl.color,
            "total_expense": float(exp), "total_income": float(inc), "count": cnt,
        })

    return jsonify({
        "year": year,
        "month": month,
        "period_mode": "month" if month else "year",
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


@api_bp.route("/loans/<int:wid>/schedule", methods=["GET"])
@login_required
def get_loan_schedule(wid):
    """Generate amortization schedule for a loan wallet, overlaying actual payments."""
    from dateutil.relativedelta import relativedelta

    w = Wallet.query.filter_by(id=wid, user_id=current_user.id, is_loan=True).first()
    if not w:
        return jsonify({"error": "Loan not found"}), 404

    principal = w.loan_outstanding or w.balance
    roi = w.loan_roi or 0
    tenure = w.loan_tenure or 0
    monthly_rate = roi / 12 / 100

    if monthly_rate > 0 and tenure > 0:
        emi = principal * monthly_rate * (1 + monthly_rate) ** tenure / ((1 + monthly_rate) ** tenure - 1)
    elif tenure > 0:
        emi = principal / tenure
    else:
        emi = 0
    emi = round(emi, 2)

    # Gather actual payments (transfers INTO this loan wallet, which reduce balance)
    transfers_in = Transfer.query.filter_by(to_wallet_id=wid, user_id=current_user.id).order_by(Transfer.date).all()
    # Group actual payments by month (YYYY-MM), separating regular and extra
    actual_by_month = {}
    for tr in transfers_in:
        key = tr.date.strftime("%Y-%m")
        actual_by_month.setdefault(key, {"regular": 0.0, "extra": 0.0})
        if tr.is_extra_payment:
            actual_by_month[key]["extra"] += tr.to_amount
        else:
            actual_by_month[key]["regular"] += tr.to_amount

    # Determine start date: wallet creation or first transfer, whichever is earlier
    first_transfer = transfers_in[0].date if transfers_in else None
    if w.created_at:
        loan_start = w.created_at.date() if hasattr(w.created_at, 'date') else w.created_at
        # Use first day of that month
        loan_start = loan_start.replace(day=1)
    else:
        loan_start = date.today().replace(day=1)
    if first_transfer and first_transfer.replace(day=1) < loan_start:
        loan_start = first_transfer.replace(day=1)

    schedule = []
    balance = principal  # keep full precision, only round for display
    cumulative_interest = 0.0
    num_months = tenure if tenure > 0 else 360  # cap at 30yr if no tenure

    for i in range(1, num_months + 1):
        if balance <= 0.005:  # effectively zero
            break

        pmt_date = loan_start + relativedelta(months=i - 1)
        month_key = pmt_date.strftime("%Y-%m")
        beginning_balance = round(balance, 2)

        # Step 1: Interest on current balance (bank formula: balance × monthly rate)
        interest = round(balance * monthly_rate, 2)

        # Actual payments this month (using is_extra_payment flag)
        month_data = actual_by_month.get(month_key, {"regular": 0.0, "extra": 0.0})
        regular_paid = round(month_data["regular"], 2)
        extra_paid = round(month_data["extra"], 2)
        actual_total = regular_paid + extra_paid

        if actual_total > 0:
            # Actual payments were made this month
            # Payment = regular EMI portion (what was paid as scheduled EMI)
            payment = regular_paid
            extra = extra_paid
            # Step 2: Principal = Total paid − Interest for this month
            total_principal = round(actual_total - interest, 2)
            if total_principal < 0:
                total_principal = 0.0
        else:
            # No actual payment yet — use scheduled (theoretical) values
            payment = emi
            extra = 0.0
            # Step 2: Scheduled principal = EMI − Interest
            total_principal = round(emi - interest, 2)

        # Last payment adjustment: cap principal so balance doesn't go negative
        if total_principal > beginning_balance:
            total_principal = beginning_balance
            if actual_total > 0:
                payment = round(interest + total_principal - extra, 2)
            else:
                payment = round(interest + total_principal, 2)
                extra = 0.0

        # Step 3: Ending Balance = Beginning Balance − Principal paid
        balance = round(beginning_balance - total_principal, 2)
        if balance < 0:
            balance = 0.0

        # Step 4: Cumulative interest
        cumulative_interest = round(cumulative_interest + interest, 2)

        schedule.append({
            "pmt_no": i,
            "date": pmt_date.strftime("%d/%m/%Y"),
            "date_iso": pmt_date.isoformat(),
            "beginning_balance": beginning_balance,
            "payment": round(payment, 2),
            "extra_payment": round(extra, 2),
            "principal": round(total_principal, 2),
            "interest": interest,
            "ending_balance": balance,
            "total_interest": cumulative_interest,
            "has_actual": actual_total > 0,
        })

    symbol = SUPPORTED_CURRENCIES.get(w.currency, {}).get("symbol", "€")
    return jsonify({
        "wallet": _wallet_to_dict(w),
        "emi": emi,
        "principal": principal,
        "roi": roi,
        "tenure": tenure,
        "symbol": symbol,
        "schedule": schedule,
    })


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
        "is_extra_payment": bool(t.is_extra_payment),
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
        "is_credit_card": bool(getattr(w, 'is_credit_card', False)),
        "is_loan": bool(w.is_loan),
        "loan_outstanding": w.loan_outstanding,
        "loan_roi": w.loan_roi,
        "loan_tenure": w.loan_tenure,
        "loan_counterparty": w.loan_counterparty or "",
        "loan_note": w.loan_note or "",
    }


def _recurring_to_dict(r):
    wallet_currency = r.wallet.currency if r.wallet else "EUR"
    symbol = SUPPORTED_CURRENCIES.get(wallet_currency, {}).get("symbol", "€")
    freq_labels = {
        "weekly": "Weekly",
        "monthly": "Monthly",
        "3months": "Every 3 Months",
        "6months": "Every 6 Months",
        "yearly": "Yearly",
    }
    return {
        "id": r.id,
        "amount": r.amount,
        "exchange_rate": r.exchange_rate,
        "currency": wallet_currency,
        "symbol": symbol,
        "type": r.type,
        "note": r.note,
        "frequency": r.frequency,
        "frequency_label": freq_labels.get(r.frequency, r.frequency),
        "start_date": r.start_date.isoformat(),
        "end_date": r.end_date.isoformat() if r.end_date else None,
        "next_date": r.next_date.isoformat(),
        "active": r.active,
        "wallet_id": r.wallet_id,
        "wallet_name": r.wallet.name if r.wallet else "",
        "category_id": r.category_id,
        "category_name": r.category.name if r.category else "",
        "category_icon": r.category.icon if r.category else "",
        "category_color": r.category.color if r.category else "",
    }
