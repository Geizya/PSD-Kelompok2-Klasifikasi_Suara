from pathlib import Path
import warnings
import numpy as np
import pandas as pd
import librosa
import joblib

from sklearn.model_selection import GroupShuffleSplit
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    classification_report, confusion_matrix,
    accuracy_score, balanced_accuracy_score, f1_score
)
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline

warnings.filterwarnings("ignore", category=UserWarning)

BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
ARTIFACT_DIR = OUTPUT_DIR / "artifacts"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

SAMPLE_RATE = 16_000
SEGMENT_SECONDS = 5
MIN_SEGMENT_SECONDS = 2
RANDOM_STATE = 42
N_MFCC = 13

LABEL_DIRS = {
    "berisik": BASE_DIR / "berisik",
    "non_berisik": BASE_DIR / "non-berisik",
}

AUDIO_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".wma"}

def extract_features(y, sr):
    y = np.asarray(y, dtype=np.float32)
    if y.size == 0:
        raise ValueError("Audio kosong.")

    rms = librosa.feature.rms(y=y)[0]
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    zcr = librosa.feature.zero_crossing_rate(y)[0]
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=N_MFCC)

    features = {}
    for name, values in [
        ("rms", rms),
        ("spectral_centroid", centroid),
        ("zcr", zcr),
    ]:
        features[f"{name}_mean"] = float(np.mean(values))
        features[f"{name}_std"] = float(np.std(values))

    for i in range(N_MFCC):
        features[f"mfcc_{i+1}_mean"] = float(np.mean(mfcc[i]))
        features[f"mfcc_{i+1}_std"] = float(np.std(mfcc[i]))
    return features

def load_audio(path, sr=SAMPLE_RATE):
    y, _ = librosa.load(str(path), sr=sr, mono=True)
    if y.size == 0:
        raise ValueError(f"Audio kosong: {path}")
    return y.astype(np.float32)

def audio_to_segments(path, sr=SAMPLE_RATE, segment_seconds=SEGMENT_SECONDS):
    y = load_audio(path, sr=sr)
    segment_length = int(sr * segment_seconds)
    min_length = int(sr * MIN_SEGMENT_SECONDS)
    segments = []

    for start in range(0, len(y), segment_length):
        segment = y[start:start + segment_length]
        if len(segment) < min_length:
            continue
        if len(segment) < segment_length:
            segment = np.pad(segment, (0, segment_length - len(segment)))
        segments.append(segment.astype(np.float32))

    return segments

def main():
    print("Mencari file audio...")
    files_by_label = {}
    for label, folder in LABEL_DIRS.items():
        files_by_label[label] = sorted(
            p for p in folder.rglob("*")
            if p.is_file() and p.suffix.lower() in AUDIO_EXTENSIONS
        ) if folder.exists() else []
        print(f"Label '{label}': {len(files_by_label[label])} file.")

    # Simpan inventaris
    inv_records = []
    for label, paths in files_by_label.items():
        for p in paths:
            inv_records.append({
                "kelas": label,
                "nama_file": p.name,
                "path_file": str(p),
                "ekstensi": p.suffix.lower(),
                "ukuran_byte": p.stat().st_size
            })
    pd.DataFrame(inv_records).to_csv(OUTPUT_DIR / "inventaris_audio.csv", index=False, encoding="utf-8-sig")

    print("\nEkstraksi fitur segmen...")
    rows = []
    errors = []
    for label, paths in files_by_label.items():
        for path in paths:
            try:
                segments = audio_to_segments(path)
                if not segments:
                    errors.append((str(path), "Audio terlalu pendek atau kosong"))
                    continue
                for seg_idx, seg in enumerate(segments):
                    feat = extract_features(seg, SAMPLE_RATE)
                    feat.update({
                        "label": label,
                        "group_id": path.stem,
                        "file_source": path.name,
                        "segment_index": seg_idx
                    })
                    rows.append(feat)
            except Exception as e:
                errors.append((str(path), str(e)))

    if errors:
        print(f"Peringatan: {len(errors)} file bermasalah.")
        pd.DataFrame(errors, columns=["file", "alasan"]).to_csv(
            OUTPUT_DIR / "log_file_gagal.csv", index=False, encoding="utf-8-sig"
        )

    df = pd.DataFrame(rows)
    print(f"Total segmen diekstrak: {len(df)}")
    feature_cols = [
        c for c in df.columns
        if c.startswith(("rms_", "spectral_centroid_", "zcr_", "mfcc_"))
    ]
    features_csv = OUTPUT_DIR / "fitur_audio.csv"
    df.to_csv(features_csv, index=False, encoding="utf-8-sig")
    print(f"Fitur disimpan ke: {features_csv}")

    X = df[feature_cols].replace([np.inf, -np.inf], np.nan)
    y = df["label"]
    groups = df["group_id"]

    splitter = GroupShuffleSplit(n_splits=30, test_size=0.20, random_state=RANDOM_STATE)
    train_idx = test_idx = None
    for candidate_train, candidate_test in splitter.split(X, y, groups=groups):
        if y.iloc[candidate_train].nunique() == 2 and y.iloc[candidate_test].nunique() == 2:
            train_idx, test_idx = candidate_train, candidate_test
            break

    if train_idx is None:
        raise ValueError("Tidak ditemukan pembagian train/test yang memuat kedua kelas.")

    X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
    y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]

    print(f"Data latih: {len(X_train)} segmen | Data uji: {len(X_test)} segmen")

    model = Pipeline(steps=[
        ("imputer", SimpleImputer(strategy="median")),
        ("classifier", RandomForestClassifier(
            n_estimators=400,
            max_features="sqrt",
            min_samples_leaf=2,
            class_weight="balanced",
            random_state=RANDOM_STATE,
            n_jobs=-1
        ))
    ])

    print("Melatih model Random Forest...")
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    acc = accuracy_score(y_test, y_pred)
    f1 = f1_score(y_test, y_pred, average="macro")
    print(f"Akurasi Test: {acc:.4f} | F1-Score: {f1:.4f}")
    print("\nClassification Report:")
    print(classification_report(y_test, y_pred, zero_division=0))

    artifact = {
        "model": model,
        "feature_columns": feature_cols,
        "sample_rate": SAMPLE_RATE,
        "segment_seconds": SEGMENT_SECONDS,
        "min_segment_seconds": MIN_SEGMENT_SECONDS,
        "labels": ["berisik", "non_berisik"],
        "feature_description": "RMS, Spectral Centroid, ZCR, dan MFCC 1-13 (mean/std)",
        "accuracy": float(acc),
        "f1_score": float(f1)
    }

    model_path = ARTIFACT_DIR / "audio_classifier_random_forest.joblib"
    joblib.dump(artifact, model_path)
    print(f"\nModel berhasil disimpan ke: {model_path.resolve()}")

if __name__ == "__main__":
    main()
