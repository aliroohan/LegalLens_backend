"""
Unit tests for reverse_image_search.py and reverse_image_search_service.py using RapidAPI
"""

import sys
import os
from unittest.mock import MagicMock, patch
import pytest

# Add Image-forensics/src and project root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "Image-forensics", "src")))

from reverse_image_search import perform_reverse_image_search
from services.reverse_image_search_service import run_reverse_image_search


@pytest.fixture
def mock_rapidapi_response():
    """Create a mock RapidAPI reverse image search JSON response."""
    return {
        "status": "OK",
        "data": [
            {
                "title": "Example Match 1",
                "link": "https://example.com/page-1",
                "domain": "example.com",
                "date": "2026-01-01",
                "image": "https://example.com/match1.jpg",
            },
            {
                "title": "Example Match 2",
                "link": "https://example.com/page-2",
                "domain": "example.com",
                "date": None,
                "image": "https://example.com/match2.jpg",
            }
        ]
    }


def test_perform_reverse_image_search_with_url(mock_rapidapi_response):
    with patch("reverse_image_search.requests.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = mock_rapidapi_response
        mock_get.return_value = mock_resp

        results = perform_reverse_image_search(
            image_input="https://i.imgur.com/HBrB8p0.png",
            api_key="test_rapidapi_key",
        )

        assert results["status"] == "success"
        assert results["matches_count"] == 2
        assert len(results["matches"]) == 2
        assert results["pages_with_matching_images"] == [
            "https://example.com/page-1",
            "https://example.com/page-2",
        ]
        assert results["visually_similar_images"] == [
            "https://example.com/match1.jpg",
            "https://example.com/match2.jpg",
        ]


def test_reverse_image_search_service(mock_rapidapi_response):
    with patch("services.reverse_image_search_service.requests.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = mock_rapidapi_response
        mock_get.return_value = mock_resp

        results = run_reverse_image_search(
            image_input="https://i.imgur.com/HBrB8p0.png",
            api_key="test_rapidapi_key",
        )

        assert results["status"] == "success"
        assert results["matches_count"] == 2
        assert results["matches"][0]["title"] == "Example Match 1"


def test_missing_key_error():
    with patch.dict(os.environ, {"RAPIDAPI_KEY": ""}):
        with pytest.raises(ValueError):
            perform_reverse_image_search("https://example.com/image.png", api_key="")


def test_local_file_without_url_raises_value_error(tmp_path):
    img_file = tmp_path / "test.jpg"
    img_file.write_bytes(b"\xFF\xD8\xFF\xE0\x00\x10JFIF")

    with pytest.raises(ValueError, match="RapidAPI requires a public image URL"):
        perform_reverse_image_search(str(img_file), api_key="dummy")
