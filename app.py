"""
EV Power Analytics Dashboard — Backend (Flask)
===============================================
Upgraded version:
  • Generates data from 2026-01-01 → today
  • Flags "high" usage (> 180 kWh)
  • Stable data: same seed → same values each run
  • Falls back to generated data if DB is unavailable

Run:
    pip install flask flask-cors
    python app.py

API available at: http://127.0.0.1:5000
"""

from flask import Flask, jsonify, render_template
from flask_cors import CORS
import sqlite3
import random
from datetime import datetime, date, timedelta

# ── App Setup ──────────────────────────────────────────────
app = Flask(__name__)
CORS(app)  # Allow cross-origin requests from the frontend

DB_PATH        = "energy.db"
START_DATE     = date(2026, 1, 1)   # Dataset start date
HIGH_THRESHOLD = 180                # kWh — above this is flagged "high"


# ── Data Generator ─────────────────────────────────────────

def generate_energy_data():
    """
    Generate daily EV energy usage from START_DATE to today.

    Each entry looks like:
      {
        "date":   "2026-01-15",
        "usage":  142.5,
        "status": "normal"   ← or "high" if usage > 180
      }

    Uses a date-seeded random generator so every restart
    produces the same numbers for the same dates.
    """
    data    = []
    today   = date.today()
    current = START_DATE

    while current <= today:
        # Seed RNG per date → reproducible values
        rng   = random.Random(current.toordinal())
        usage = round(rng.uniform(80, 220), 1)

        data.append({
            "date":   current.strftime("%Y-%m-%d"),
            "usage":  usage,
            "status": "high" if usage > HIGH_THRESHOLD else "normal"
        })
        current += timedelta(days=1)

    return data


# ── Database Helpers ───────────────────────────────────────

def get_db():
    """Open a connection to the SQLite database."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create the energy_usage table and seed with full dataset."""
    conn   = get_db()
    cursor = conn.cursor()

    # Create table (if it doesn't exist yet)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS energy_usage (
            id     INTEGER PRIMARY KEY AUTOINCREMENT,
            date   TEXT NOT NULL UNIQUE,
            usage  REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'normal'
        )
    """)

    # Insert any missing dates (safe to re-run)
    for entry in generate_energy_data():
        cursor.execute("""
            INSERT OR IGNORE INTO energy_usage (date, usage, status)
            VALUES (?, ?, ?)
        """, (entry["date"], entry["usage"], entry["status"]))

    conn.commit()
    conn.close()
    print("✅ Database ready.")


# ── API Routes ─────────────────────────────────────────────

@app.route("/api/energy", methods=["GET"])
def get_energy():
    """
    GET /api/energy
    Returns the full dataset (2026-01-01 → today).
    Falls back to in-memory generated data if DB fails.
    """
    try:
        conn = get_db()
        rows = conn.execute(
            "SELECT date, usage, status FROM energy_usage ORDER BY date ASC"
        ).fetchall()
        conn.close()

        # Use DB rows if available, otherwise fall back
        data = (
            [{"date": r["date"], "usage": r["usage"], "status": r["status"]} for r in rows]
            if rows else generate_energy_data()
        )

    except Exception as e:
        print(f"⚠️  DB error ({e}), using generated data.")
        data = generate_energy_data()

    return jsonify(data)


@app.route("/api/health", methods=["GET"])
def health():
    """Quick health-check — useful for debugging."""
    return jsonify({
        "status":    "ok",
        "message":   "Mefah's Dashboard API is ready!",
        "records":   len(generate_energy_data()),
        "threshold": HIGH_THRESHOLD
    })

#-----Route สำหรับแสดงหน้า Dashboard index.html---
@app.route("/")
def index():
    """Route สำหรับแสดงหน้า Dashboard (index.html)"""
    return render_template("index.html")
# ---------------------------------------

# ── Entry Point ────────────────────────────────────────────

import os

if __name__ == "__main__":
    # ดึงค่า Port ที่ Render กำหนดให้ ถ้าไม่มีให้ใช้ 5000 เป็นค่าเริ่มต้น
    port = int(os.environ.get("PORT", 5000))
    # สำคัญมาก: host ต้องเป็น '0.0.0.0' เพื่อให้โลกภายนอกเข้าถึงได้
    app.run(host='0.0.0.0', port=port)
