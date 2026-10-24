import os
import sys
from pathlib import Path

os.environ.setdefault("HA_TOKEN", "test-token")
os.environ.setdefault("CF_ACCESS_CLIENT_ID", "id")
os.environ.setdefault("CF_ACCESS_CLIENT_SECRET", "secret")

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
