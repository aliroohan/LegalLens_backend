import os
import sys
import json
import argparse
from pathlib import Path
import requests
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

DEFAULT_RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY", "")
DEFAULT_RAPIDAPI_HOST = os.getenv("RAPIDAPI_HOST", "reverse-image-search1.p.rapidapi.com")
RAPIDAPI_URL = "https://reverse-image-search1.p.rapidapi.com/reverse-image-search"


def perform_reverse_image_search(
    image_input: str,
    api_key: str | None = None,
    api_host: str | None = None,
    limit: int = 10,
    safe_search: str = "blur",
    hosted_url: str | None = None,
) -> dict:
    """
    Performs reverse image search using RapidAPI (reverse-image-search1.p.rapidapi.com).

    Parameters
    ----------
    image_input : str
        Either a public image URL (http/https) OR a local image path.
    api_key : str, optional
        RapidAPI key (defaults to RAPIDAPI_KEY from .env).
    api_host : str, optional
        RapidAPI host (defaults to reverse-image-search1.p.rapidapi.com).
    limit : int, optional
        Maximum number of matching results to retrieve (default: 10).
    safe_search : str, optional
        Safe search setting: 'blur', 'off', etc. (default: 'blur').
    hosted_url : str, optional
        If image_input is a local file, you can pass a public URL where it is hosted.

    Returns
    -------
    dict
        Dictionary containing extracted matches and category URLs:
        - 'matches': list of match objects with title, link, domain, image, etc.
        - 'pages_with_matching_images': list of page URLs (sourceUrl)
        - 'visually_similar_images': list of matching image URLs
        - 'exact_matching_images': list of exact match image URLs
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
        raise ValueError("RapidAPI key is required. Set RAPIDAPI_KEY in .env or pass it explicitly.")

    # Determine public URL
    target_url = None
    if image_input.startswith("http://") or image_input.startswith("https://"):
        target_url = image_input
    elif hosted_url:
        target_url = hosted_url
    else:
        # User passed a local file path
        local_file = Path(image_input).resolve()
        if not local_file.is_file():
            raise FileNotFoundError(f"Image not found at path: {image_input}")

        # RapidAPI searches Google using public URLs
        raise ValueError(
            f"RapidAPI requires a public image URL (e.g. 'https://i.imgur.com/HBrB8p0.png'). "
            f"Local file '{local_file.name}' must first be uploaded to an image host (like ImgBB or Cloudinary), "
            f"or passed via --url <public_url>."
        )

    headers = {
        "x-rapidapi-key": key,
        "x-rapidapi-host": host
    }

    params = {
        "url": target_url,
        "limit": str(limit),
        "safe_search": safe_search
    }

    response = requests.get(RAPIDAPI_URL, headers=headers, params=params, timeout=30)

    if response.status_code != 200:
        try:
            err_data = response.json()
            err_msg = err_data.get("error", {}).get("message") or err_data.get("message") or response.text
        except Exception:
            err_msg = response.text
        raise RuntimeError(f"RapidAPI error (HTTP {response.status_code}): {err_msg}")

    data = response.json()
    items = data.get("data", [])

    matches = []
    pages_with_matching_images = []
    visually_similar_images = []
    exact_matching_images = []

    for item in items:
        page_link = item.get("link")
        image_link = item.get("image")
        title = item.get("title", "External Match")
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
            # Items with high relevance in Google web search
            exact_matching_images.append(image_link)

    return {
        "status": "success",
        "query_url": target_url,
        "matches_count": len(matches),
        "matches": matches,
        "exact_matching_images": exact_matching_images,
        "visually_similar_images": visually_similar_images,
        "pages_with_matching_images": pages_with_matching_images,
        # Backward compatibility aliases
        "exact matching images": exact_matching_images,
        "visually similar images": visually_similar_images,
        "pages with matching images": pages_with_matching_images,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Perform reverse image search using RapidAPI."
    )
    parser.add_argument(
        "image_target",
        nargs="?",
        default="https://i.imgur.com/HBrB8p0.png",
        help="Public image URL or local image file path (default: https://i.imgur.com/HBrB8p0.png).",
    )
    parser.add_argument(
        "--url",
        dest="hosted_url",
        default=None,
        help="Public URL of the image when providing a local file path.",
    )
    parser.add_argument(
        "--api-key",
        dest="api_key",
        default=None,
        help="RapidAPI key (defaults to RAPIDAPI_KEY from .env).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=10,
        help="Max results to return (default: 10).",
    )
    args = parser.parse_args()

    try:
        results = perform_reverse_image_search(
            image_input=args.image_target,
            api_key=args.api_key,
            hosted_url=args.hosted_url,
            limit=args.limit,
        )
        print(json.dumps(results, indent=2))
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
