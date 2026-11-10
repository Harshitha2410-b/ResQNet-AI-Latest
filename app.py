
import os
from datetime import datetime
from html import escape

from flask import (
    Flask, render_template, request,
    redirect, url_for, flash, jsonify
)

from extensions import db


# =====================================
# APPLICATION CONFIGURATION
# =====================================

app = Flask(__name__)

app.config["SECRET_KEY"] = os.environ.get(
    "RESQNET_SECRET", "resqnet-dev-key"
)

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE_DIR = os.path.join(BASE_DIR, "database")
os.makedirs(DATABASE_DIR, exist_ok=True)

db_path = os.path.join(DATABASE_DIR, "resqnet.db")

app.config["SQLALCHEMY_DATABASE_URI"] = (
    "sqlite:///" + db_path.replace("\\", "/")
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db.init_app(app)

from models.user import User


# =====================================
# SOS ALERT DATABASE MODEL
# =====================================

class Alert(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    alert_type = db.Column(db.String(50), nullable=False)
    source = db.Column(db.String(100))
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    emergency_contact = db.Column(db.String(30))
    sms_status = db.Column(db.String(30), default="PENDING")
    call_status = db.Column(db.String(30), default="PENDING")
    created_at = db.Column(
        db.DateTime, default=datetime.utcnow
    )


# =====================================
# CREATE DATABASE TABLES
# IMPORTANT: Works with Gunicorn too
# =====================================

with app.app_context():
    db.create_all()


# =====================================
# TWILIO CONFIGURATION (OPTIONAL)
# =====================================

TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN")
TWILIO_PHONE_NUMBER = os.environ.get("TWILIO_PHONE_NUMBER")


def get_twilio_client():
    if not all([
        TWILIO_ACCOUNT_SID,
        TWILIO_AUTH_TOKEN,
        TWILIO_PHONE_NUMBER
    ]):
        return None

    from twilio.rest import Client

    return Client(
        TWILIO_ACCOUNT_SID,
        TWILIO_AUTH_TOKEN
    )


def normalize_phone(phone):
    """Convert Indian 10-digit numbers to +91 format."""

    phone = "".join(
        char for char in str(phone)
        if char.isdigit() or char == "+"
    )

    if phone.startswith("+"):
        return phone

    if len(phone) == 10:
        return "+91" + phone

    if len(phone) == 12 and phone.startswith("91"):
        return "+" + phone

    raise ValueError(
        "Emergency contact must be a valid number with country code."
    )


def send_sos_sms(client, contact, alert):

    maps_link = ""

    if alert.latitude is not None and alert.longitude is not None:
        maps_link = (
            f"https://www.google.com/maps?q="
            f"{alert.latitude},{alert.longitude}"
        )

    message = (
        "RESQNET AI EMERGENCY ALERT\n"
        "A possible emergency SOS has been activated.\n"
        f"Alert ID: {alert.id}\n"
        f"Time: {alert.created_at} UTC\n"
        f"Location: {maps_link or 'Unavailable'}\n"
        "Please contact the person and verify their safety."
    )

    return client.messages.create(
        body=message,
        from_=TWILIO_PHONE_NUMBER,
        to=contact
    )


def make_sos_call(client, contact, alert):

    location_text = "Location is unavailable."

    if alert.latitude is not None and alert.longitude is not None:
        location_text = (
            f"Location coordinates are latitude "
            f"{alert.latitude:.5f} and longitude "
            f"{alert.longitude:.5f}. "
        )

    spoken_message = (
        "ResQNet AI emergency alert. "
        "A possible emergency SOS has been activated. "
        "Please contact your registered person immediately. "
        + location_text
    )

    twiml = (
        "<Response><Say language='en-IN'>"
        + escape(spoken_message)
        + "</Say></Response>"
    )

    return client.calls.create(
        to=contact,
        from_=TWILIO_PHONE_NUMBER,
        twiml=twiml
    )


# =====================================
# HOME AND INFORMATION PAGES
# =====================================

@app.route("/")
def home():
    return render_template("index.html")


@app.route("/features")
def features():
    return render_template("features.html")


@app.route("/about")
def about():
    return render_template("about.html")


@app.route("/contact")
def contact():
    return render_template("contact.html")


# =====================================
# DASHBOARD
# =====================================

@app.route("/dashboard")
def dashboard():

    user = User.query.order_by(User.id.desc()).first()

    alerts = Alert.query.order_by(
        Alert.created_at.desc()
    ).limit(10).all()

    return render_template(
        "dashboard.html",
        user=user,
        alerts=alerts
    )


# =====================================
# USER REGISTRATION
# =====================================

@app.route("/register", methods=["GET", "POST"])
def register():

    if request.method == "POST":

        full_name = request.form.get(
            "full_name", ""
        ).strip()

        phone = request.form.get(
            "phone", ""
        ).strip()

        emergency_contact = request.form.get(
            "emergency_contact", ""
        ).strip()

        if not full_name or not phone or not emergency_contact:
            flash("Please fill in all fields.", "error")
            return redirect(url_for("register"))

        new_user = User(
            full_name=full_name,
            phone=phone,
            emergency_contact=emergency_contact
        )

        try:
            db.session.add(new_user)
            db.session.commit()

            flash("Registration successful!", "success")
            return redirect(url_for("dashboard"))

        except Exception:
            db.session.rollback()
            app.logger.exception("Registration failed")

            flash(
                "Registration failed. Please try again.",
                "error"
            )
            return redirect(url_for("register"))

    return render_template("register.html")


# =====================================
# CREATE SOS ALERT
# =====================================

@app.route("/api/sos", methods=["POST"])
def create_sos():

    data = request.get_json(silent=True) or {}

    latitude = data.get("latitude")
    longitude = data.get("longitude")

    try:
        latitude = (
            float(latitude) if latitude is not None else None
        )

        longitude = (
            float(longitude) if longitude is not None else None
        )

        if latitude is not None and not -90 <= latitude <= 90:
            raise ValueError("Invalid latitude")

        if longitude is not None and not -180 <= longitude <= 180:
            raise ValueError("Invalid longitude")

    except (ValueError, TypeError):
        return jsonify({
            "success": False,
            "error": "Invalid GPS coordinates."
        }), 400

    user = User.query.order_by(User.id.desc()).first()

    if not user:
        return jsonify({
            "success": False,
            "error": "Please register a user before activating SOS."
        }), 400

    try:
        contact = normalize_phone(user.emergency_contact)

    except ValueError as error:
        return jsonify({
            "success": False,
            "error": str(error)
        }), 400

    alert = Alert(
        alert_type="SILENT SOS",
        source=data.get("source", "Dashboard"),
        latitude=latitude,
        longitude=longitude,
        emergency_contact=contact,
        sms_status="PENDING",
        call_status="PENDING"
    )

    try:
        db.session.add(alert)
        db.session.commit()

    except Exception:
        db.session.rollback()
        app.logger.exception("Could not save SOS alert")

        return jsonify({
            "success": False,
            "error": "Could not save SOS alert."
        }), 500

    sms_status = "NOT CONFIGURED"
    call_status = "NOT CONFIGURED"

    try:
        client = get_twilio_client()

        if client is not None:

            try:
                sms = send_sos_sms(client, contact, alert)
                sms_status = "SENT"
                app.logger.info("SOS SMS SID: %s", sms.sid)

            except Exception:
                sms_status = "FAILED"
                app.logger.exception("SOS SMS failed")

            try:
                call = make_sos_call(client, contact, alert)
                call_status = "INITIATED"
                app.logger.info("SOS CALL SID: %s", call.sid)

            except Exception:
                call_status = "FAILED"
                app.logger.exception("SOS call failed")

        alert.sms_status = sms_status
        alert.call_status = call_status
        db.session.commit()

    except Exception:
        db.session.rollback()
        app.logger.exception("SOS notification setup failed")

    return jsonify({
        "success": True,
        "alert_id": alert.id,
        "message": "SOS alert recorded.",
        "latitude": latitude,
        "longitude": longitude,
        "sms_status": sms_status,
        "call_status": call_status,
        "time": alert.created_at.isoformat()
    }), 201


# =====================================
# ALERT HISTORY API
# =====================================

@app.route("/api/alerts")
def alert_history():

    alerts = Alert.query.order_by(
        Alert.created_at.desc()
    ).limit(50).all()

    return jsonify([
        {
            "id": alert.id,
            "type": alert.alert_type,
            "source": alert.source,
            "latitude": alert.latitude,
            "longitude": alert.longitude,
            "sms_status": alert.sms_status,
            "call_status": alert.call_status,
            "created_at": alert.created_at.isoformat()
        }
        for alert in alerts
    ])


# =====================================
# HEALTH CHECK
# =====================================

@app.route("/health")
def health():

    return jsonify({
        "status": "running",
        "application": "ResQNet AI"
    })


# =====================================
# RUN APPLICATION
# =====================================

if __name__ == "__main__":

    with app.app_context():
        db.create_all()

    print("\n================================")
    print("       RESQNET AI STARTED")
    print("================================")
    print("Local: http://127.0.0.1:5000")
    print("Network: http://YOUR-LAPTOP-IP:5000")
    print("================================\n")

    app.run(
        host="0.0.0.0",
        port=5000,
        debug=False
    )
