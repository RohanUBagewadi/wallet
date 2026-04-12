"""Backup wallet.db to backups/ with timestamp."""
import shutil, os
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "instance", "wallet.db")
BACKUP_DIR = os.path.join(BASE, "backups")

os.makedirs(BACKUP_DIR, exist_ok=True)

stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
dest = os.path.join(BACKUP_DIR, f"wallet_{stamp}.db")

shutil.copy2(DB, dest)
print(f"Backed up to: {dest}")

# Keep only last 10 backups
backups = sorted(
    [f for f in os.listdir(BACKUP_DIR) if f.endswith(".db")],
    reverse=True,
)
for old in backups[10:]:
    os.remove(os.path.join(BACKUP_DIR, old))
    print(f"Removed old backup: {old}")
