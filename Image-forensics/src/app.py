from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes.analysis_router import router as analysis_router

app = FastAPI(
    title="ForensicLens API",
    description="Image forensics tool.",
    version="1.0.0",
)

# CORS — allow frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount analysis routes
app.include_router(analysis_router)


@app.get("/")
def health_check():
    return {
        "status": "ok",
        "app": "ForensicLens API",
        "routes": {
            "analyze": "POST /api/analyze",
            "report": "POST /api/report",
        },
    }
