# ──────────────────────────────────────────────────────────────
#  ForensicLens Backend — Hugging Face Spaces Dockerfile
#  Runs the FastAPI image forensics API on port 7860
# ──────────────────────────────────────────────────────────────

FROM python:3.11-slim

# HF Spaces runs containers as user with uid 1000
RUN useradd -m -u 1000 appuser

WORKDIR /app

# System deps required by OpenCV
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libgl1-mesa-glx \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY src/ ./src/

# Own files as non-root user
RUN chown -R appuser:appuser /app
USER appuser

# HF Spaces expects port 7860
EXPOSE 7860

WORKDIR /app/src
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
