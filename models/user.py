from extensions import db

class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)

    full_name = db.Column(db.String(100), nullable=False)

    phone = db.Column(db.String(20), nullable=False)

    emergency_contact = db.Column(db.String(20), nullable=False)

    latitude = db.Column(db.String(50), nullable=True)

    longitude = db.Column(db.String(50), nullable=True)

    def __repr__(self):
        return f"<User {self.full_name}>"