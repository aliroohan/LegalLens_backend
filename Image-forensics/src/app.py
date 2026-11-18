from contextlib import asynccontextmanager
import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes.analysis_router import router as analysis_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load YOLO once at server startup (downloads weights only if the file is missing),
    # so the first user upload doesn't pay the loading cost.
    from services.lighting_shadow_service import _get_yolo
    await asyncio.to_thread(_get_yolo)
    yield


app = FastAPI(
    title="ForensicLens API",
    description="Image forensics tool.",
    version="1.0.0",
    lifespan=lifespan,
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