"""Start the unified AURAMAXX + VisionFace website with one HTTP listener."""
import os

import uvicorn
from backend import settings  # Load .env before selecting database adapters.


def main():
    uvicorn.run("backend.main:app", host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8000")))


if __name__ == "__main__":
    main()
