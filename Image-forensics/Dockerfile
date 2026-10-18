# ──────────────────────────────────────────────────────────────
#  ForensicLens Backend — Hugging Face Spaces Dockerfile
#  Runs the FastAPI image forensics API on port 7860
# ──────────────────────────────────────────────────────────────

FROM python:3.11-slim

# HF Spaces runs containers as user with uid 1000
RUN useradd -m -u 1000 appuser

WORKDIR /app

# System deps required by OpenCV
# Force HTTPS apt mirrors (some networks block plain HTTP on port 80).
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources && \
    apt-get update -o Acquire::Retries=5 && \
    apt-get install -y --no-install-recommends \
        libgl1 \
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
