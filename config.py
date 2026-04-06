import os

basedir = os.path.abspath(os.path.dirname(__file__))

# Ensure instance directory exists
instance_path = os.path.join(basedir, "instance")
os.makedirs(instance_path, exist_ok=True)


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key-change-in-production")
    _db_url = os.environ.get("DATABASE_URL", "sqlite:///" + os.path.join(instance_path, "wallet.db"))
    # Render/Heroku supply 'postgres://' but SQLAlchemy requires 'postgresql://'
    if _db_url.startswith("postgres://"):
        _db_url = _db_url.replace("postgres://", "postgresql://", 1)
    SQLALCHEMY_DATABASE_URI = _db_url
    SQLALCHEMY_TRACK_MODIFICATIONS = False
