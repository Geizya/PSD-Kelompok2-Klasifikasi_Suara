# ── Stage: Build & Run ──────────────────────────────────────────────────────
# Gunakan Python 3.11 slim (ringan, tanpa banyak paket bawaan yang tidak perlu)
FROM python:3.11-slim

# Set working directory di dalam container
WORKDIR /app

# Instal dependensi sistem Linux yang dibutuhkan librosa & ffmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Salin requirements.txt terlebih dahulu (memanfaatkan layer cache Docker)
COPY requirements.txt .

# Instal semua dependensi Python
RUN pip install --no-cache-dir -r requirements.txt

# Salin seluruh kode project ke dalam container
COPY app.py .
COPY static/ ./static/
COPY output/ ./output/
COPY notif.mp3 .
COPY nofit.mp3 .
COPY cobasuara1.mp3 .

# Buka port 8000 (port yang digunakan FastAPI / Uvicorn)
EXPOSE 8000

# Jalankan aplikasi saat container distart
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]

