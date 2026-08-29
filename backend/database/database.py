"""Database connection and session management."""
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Text, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
from backend.config import DATABASE_URL

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Dataset(Base):
    __tablename__ = "datasets"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    filename = Column(String, nullable=False)
    rows = Column(Integer)
    columns = Column(Integer)
    file_size = Column(Float)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    experiments = relationship("Experiment", back_populates="dataset")


class Experiment(Base):
    __tablename__ = "experiments"
    id = Column(Integer, primary_key=True, index=True)
    dataset_id = Column(Integer, ForeignKey("datasets.id"))
    target = Column(String)
    problem_type = Column(String)
    best_model = Column(String)
    best_score = Column(Float)
    features = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    dataset = relationship("Dataset", back_populates="experiments")
    models = relationship("MLModel", back_populates="experiment")


class MLModel(Base):
    __tablename__ = "models"
    id = Column(Integer, primary_key=True, index=True)
    experiment_id = Column(Integer, ForeignKey("experiments.id"))
    model_name = Column(String)
    parameters = Column(Text)
    metrics = Column(Text)
    model_path = Column(String)
    training_time = Column(Float)
    created_at = Column(DateTime, default=datetime.utcnow)
    experiment = relationship("Experiment", back_populates="models")
    predictions = relationship("Prediction", back_populates="model")


class Prediction(Base):
    __tablename__ = "predictions"
    id = Column(Integer, primary_key=True, index=True)
    model_id = Column(Integer, ForeignKey("models.id"))
    input_data = Column(Text)
    prediction = Column(Text)
    confidence = Column(Float)
    created_at = Column(DateTime, default=datetime.utcnow)
    model = relationship("MLModel", back_populates="predictions")


def create_tables():
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
