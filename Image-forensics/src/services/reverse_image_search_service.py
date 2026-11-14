"""
Reverse Image Search Service
----------------------------
Performs reverse image search using RapidAPI (reverse-image-search1.p.rapidapi.com).
Finds web pages, domains, and visually similar images matching a queried image.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Union
import requests
from dotenv import load_dotenv

load_dotenv()

DEFAULT_RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY", "")
DEFAULT_RAPIDAPI_HOST = os.getenv("RAPIDAPI_HOST", "reverse-image-search1.p.rapidapi.com")
RAPIDAPI_URL = "https://reverse-image-search1.p.rapidapi.com/reverse-image-search"


def run_reverse_image_search(
    image_input: Union[str, Path],
    api_key: str | None = None,
    api_host: str | None = None,
    limit: int = 10,
    safe_search: str = "blur",
    hosted_url: str | None = None,
) -> dict:
    """
    Performs Reverse Image Search via RapidAPI.

    Parameters
    ----------
    image_input : str or Path
        Public image URL (http/https) or local file path.
    api_key : str, optional
        RapidAPI key.
    api_host : str, optional
        RapidAPI host header.
    limit : int, optional
        Max matches to return (default: 10).
    safe_search : str, optional
        Safe search mode (default: 'blur').
    hosted_url : str, optional
        Public image URL if image_input is a local file.

    Returns
    -------
    dict with keys:
        - status: str
        - matches_count: int
        - matches: list[dict]
        - exact_matching_images: list[str]
        - visually_similar_images: list[str]
        - pages_with_matching_images: list[str]
        - exact matching images: list[str]
        - visually similar images: list[str]
        - pages with matching images: list[str]
    """
    if api_key is not None:
        key = api_key
    else:
        key = os.getenv("RAPIDAPI_KEY") or DEFAULT_RAPIDAPI_KEY

    if api_host is not None:
        host = api_host
    else:
        host = os.getenv("RAPIDAPI_HOST") or DEFAULT_RAPIDAPI_HOST

    if not key:
        raise ValueError("RapidAPI key is missing. Set RAPIDAPI_KEY in .env.")

    str_input = str(image_input).strip()
    target_url = None

    if str_input.startswith("http://") or str_input.startswith("https://"):
        target_url = str_input
    elif hosted_url:
        target_url = hosted_url
    else:
        file_path = Path(str_input).resolve()
        if not file_path.is_file():
            raise FileNotFoundError(f"File not found: {str_input}")
        raise ValueError(
            f"RapidAPI requires a public image URL. Please provide a hosted_url for '{file_path.name}'."
        )

    headers = {
        "x-rapidapi-key": key,
        "x-rapidapi-host": host,
    }
    params = {
        "url": target_url,
        "limit": str(limit),
        "safe_search": safe_search,
    }

    resp = requests.get(RAPIDAPI_URL, headers=headers, params=params, timeout=30)
    if resp.status_code != 200:
        try:
            err_data = resp.json()
            err_msg = err_data.get("error", {}).get("message") or err_data.get("message") or resp.text
        except Exception:
            err_msg = resp.text
        raise RuntimeError(f"RapidAPI error (HTTP {resp.status_code}): {err_msg}")

    data = resp.json()
    items = data.get("data", [])

    matches = []
    pages_with_matching_images = []
    visually_similar_images = []
    exact_matching_images = []

    for item in items:
        page_link = item.get("link")
        image_link = item.get("image")
        title = item.get("title", "External Web Match")
        domain = item.get("domain", "")
        date = item.get("date")

        match_obj = {
            "title": title,
            "sourceUrl": page_link,
            "matchImageUrl": image_link,
            "domain": domain,
            "date": date,
            "snippet": f"Source: {domain} ({date})" if domain and date else (domain or "")
        }
        matches.append(match_obj)

        if page_link:
            pages_with_matching_images.append(page_link)
        if image_link:
            visually_similar_images.append(image_link)
            exact_matching_images.append(image_link)

    return {
        "status": "success",
        "query_url": target_url,
        "matches_count": len(matches),
        "matches": matches,
        "exact_matching_images": exact_matching_images,
        "visually_similar_images": visually_similar_images,
        "pages_with_matching_images": pages_with_matching_images,
        "exact matching images": exact_matching_images,
        "visually similar images": visually_similar_images,
        "pages with matching images": pages_with_matching_images,
    }
