import io
import os
import subprocess
from pathlib import Path
from typing import List, Optional

import joblib
import librosa
import numpy as np
import pandas as pd
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import imageio_ffmpeg

# Paths
BASE_DIR = Path(__file__).resolve().parent
ARTIFACT_PATH = BASE_DIR / "output" / "artifacts" / "audio_classifier_random_forest.joblib"
STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)
NOTIF_PATH = BASE_DIR / "notif.mp3"
NOFIT_PATH = BASE_DIR / "nofit.mp3"

# Ensure both notif.mp3 and nofit.mp3 exist
if NOTIF_PATH.exists() and not NOFIT_PATH.exists():
    import shutil
    shutil.copy(NOTIF_PATH, NOFIT_PATH)
elif NOFIT_PATH.exists() and not NOTIF_PATH.exists():
    import shutil
    shutil.copy(NOFIT_PATH, NOTIF_PATH)

# Load trained model artifact
if not ARTIFACT_PATH.exists():
    raise RuntimeError(f"Model artifact belum ditemukan di {ARTIFACT_PATH}. Silakan jalankan train_model.py terlebih dahulu.")

artifact = joblib.load(ARTIFACT_PATH)
model = artifact["model"]
feature_cols = artifact["feature_columns"]
SAMPLE_RATE = artifact.get("sample_rate", 16000)
SEGMENT_SECONDS = artifact.get("segment_seconds", 5)
MIN_SEGMENT_SECONDS = artifact.get("min_segment_seconds", 2)
N_MFCC = 13

# Initialize FastAPI
app = FastAPI(title="Sistem Klasifikasi Suara Berisik / Non-Berisik", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def decode_audio_bytes(audio_bytes: bytes, target_sr: int = SAMPLE_RATE) -> np.ndarray:
    """Mendekode audio dari byte menggunakan imageio-ffmpeg subprocess atau fallback."""
    try:
        ffmpeg_bin = imageio_ffmpeg.get_ffmpeg_exe()
        cmd = [
            ffmpeg_bin,
            "-i", "pipe:0",
            "-vn",
            "-f", "s16le",
            "-ac", "1",
            "-ar", str(target_sr),
            "pipe:1"
        ]
        p = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        out, err = p.communicate(input=audio_bytes)
        if p.returncode == 0 and len(out) > 0:
            return np.frombuffer(out, dtype=np.int16).astype(np.float32) / 32768.0
    except Exception as e:
        print(f"Subprocess ffmpeg failed: {e}")

    # Fallback to soundfile / io.BytesIO
    try:
        import soundfile as sf
        y, sr = sf.read(io.BytesIO(audio_bytes))
        if y.ndim > 1:
            y = np.mean(y, axis=1)
        if sr != target_sr:
            y = librosa.resample(y, orig_sr=sr, target_sr=target_sr)
        return y.astype(np.float32)
    except Exception as e2:
        raise ValueError(f"Gagal memproses data audio: {e2}")

def extract_segment_features(y: np.ndarray, sr: int = SAMPLE_RATE) -> dict:
    """Mengekstrak 32 fitur audio sesuai dengan arsitektur ipynb."""
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

def classify_audio_array(y: np.ndarray, sr: int = SAMPLE_RATE) -> dict:
    total_samples = len(y)
    duration = float(total_samples / sr)
    if duration < 0.2:
        raise ValueError("Durasi audio terlalu singkat (< 0.2 detik).")

    segment_length = int(sr * SEGMENT_SECONDS)
    min_length = int(sr * MIN_SEGMENT_SECONDS)

    segments = []
    segment_ranges = []

    if total_samples < segment_length:
        # Pad up to segment length if duration is short but >= 0.2s
        pad_size = segment_length - total_samples
        padded = np.pad(y, (0, pad_size))
        segments.append(padded)
        segment_ranges.append((0.0, duration))
    else:
        for start in range(0, total_samples, segment_length):
            seg = y[start:start + segment_length]
            if len(seg) < min_length and len(segments) > 0:
                continue
            actual_end = min(start + len(seg), total_samples) / sr
            actual_start = start / sr
            if len(seg) < segment_length:
                seg = np.pad(seg, (0, segment_length - len(seg)))
            segments.append(seg.astype(np.float32))
            segment_ranges.append((actual_start, actual_end))

    # Feature extraction per segment
    feature_rows = [extract_segment_features(seg, sr) for seg in segments]
    X_df = pd.DataFrame(feature_rows).reindex(columns=feature_cols)

    predictions = model.predict(X_df)
    probabilities = model.predict_proba(X_df)
    classes = list(model.named_steps["classifier"].classes_)
    berisik_idx = classes.index("berisik") if "berisik" in classes else 0
    non_berisik_idx = classes.index("non_berisik") if "non_berisik" in classes else 1

    segment_details = []
    berisik_count = 0
    for i, (pred, proba, (st, en)) in enumerate(zip(predictions, probabilities, segment_ranges)):
        prob_berisik = float(proba[berisik_idx])
        prob_non = float(proba[non_berisik_idx])
        is_b = (pred == "berisik")
        if is_b:
            berisik_count += 1
        segment_details.append({
            "segment_number": i + 1,
            "start_time": round(st, 2),
            "end_time": round(en, 2),
            "prediction": str(pred),
            "probability_berisik": round(prob_berisik, 4),
            "probability_non_berisik": round(prob_non, 4),
            "label_display": "BERISIK" if is_b else "NON-BERISIK"
        })

    # Final decision: if any segment is berisik or majority is berisik
    # When listening continuously, detecting berisik in any segment should warn the user
    majority_pred = pd.Series(predictions).value_counts().idxmax()
    overall_prob_berisik = float(np.mean([s["probability_berisik"] for s in segment_details]))
    overall_prob_non = float(np.mean([s["probability_non_berisik"] for s in segment_details]))

    # If stream chunk has berisik segment or majority is berisik
    final_is_berisik = (berisik_count > 0) if len(segments) == 1 else (majority_pred == "berisik")

    # Audio energy / level (RMS)
    overall_rms = float(np.sqrt(np.mean(y**2)))

    return {
        "final_prediction": "berisik" if final_is_berisik else "non_berisik",
        "final_label": "BERISIK" if final_is_berisik else "NON-BERISIK",
        "is_berisik": bool(final_is_berisik),
        "trigger_feedback": bool(final_is_berisik),
        "confidence_berisik": round(overall_prob_berisik, 4),
        "confidence_non_berisik": round(overall_prob_non, 4),
        "duration_seconds": round(duration, 2),
        "rms_level": round(overall_rms, 5),
        "total_segments": len(segment_details),
        "segments": segment_details,
        "feedback_audio_url": "/audio/notif.mp3"
    }

@app.get("/audio/notif.mp3")
@app.get("/audio/nofit.mp3")
async def get_feedback_audio():
    if NOTIF_PATH.exists():
        return FileResponse(NOTIF_PATH, media_type="audio/mpeg")
    elif NOFIT_PATH.exists():
        return FileResponse(NOFIT_PATH, media_type="audio/mpeg")
    raise HTTPException(status_code=404, detail="File feedback notif.mp3 tidak ditemukan.")

@app.get("/api/info")
async def get_model_info():
    return {
        "status": "ready",
        "model_type": "Random Forest Pipeline (SimpleImputer + RandomForestClassifier)",
        "n_estimators": 400,
        "sample_rate": SAMPLE_RATE,
        "segment_seconds": SEGMENT_SECONDS,
        "min_segment_seconds": MIN_SEGMENT_SECONDS,
        "feature_count": len(feature_cols),
        "accuracy": artifact.get("accuracy", 0.8577),
        "f1_score": artifact.get("f1_score", 0.8573),
        "labels": ["berisik", "non_berisik"],
        "feedback_sound": "notif.mp3"
    }

@app.post("/api/predict")
async def predict_audio_file(file: UploadFile = File(...)):
    """Menerima file audio (WAV, MP3, WebM, OGG, dll) dari mikrofon atau upload file."""
    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Data audio kosong.")

        y = decode_audio_bytes(content, target_sr=SAMPLE_RATE)
        result = classify_audio_array(y, sr=SAMPLE_RATE)
        result["filename"] = file.filename
        return JSONResponse(content=result)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/test-sample")
async def test_sample_audio():
    """Menguji coba file cobasuara1.mp3 yang ada di workspace."""
    sample_file = BASE_DIR / "cobasuara1.mp3"
    if not sample_file.exists():
        raise HTTPException(status_code=404, detail="cobasuara1.mp3 tidak ditemukan.")
    try:
        with open(sample_file, "rb") as f:
            content = f.read()
        y = decode_audio_bytes(content, target_sr=SAMPLE_RATE)
        result = classify_audio_array(y, sr=SAMPLE_RATE)
        result["filename"] = "cobasuara1.mp3"
        return JSONResponse(content=result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount static folder
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/")
async def serve_index():
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {"message": "Sistem Klasifikasi Suara Berisik siap. Buat index.html di static/"}

if __name__ == "__main__":
    import uvicorn
    print("Menjalankan server Klasifikasi Suara di http://localhost:8000 ...")
    uvicorn.run(app, host="0.0.0.0", port=8000)
