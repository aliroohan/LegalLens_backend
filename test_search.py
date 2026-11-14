import os
import requests
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("RAPIDAPI_KEY")
api_host = os.getenv("RAPIDAPI_HOST", "reverse-image-search1.p.rapidapi.com")

if not api_key:
    print("Error: RAPIDAPI_KEY is not set in your .env file.")
    exit(1)

url = "https://reverse-image-search1.p.rapidapi.com/reverse-image-search"
querystring = {
    "url": "https://i.imgur.com/HBrB8p0.png",
    "limit": "10",
    "safe_search": "blur"
}
headers = {
    "x-rapidapi-key": api_key,
    "x-rapidapi-host": api_host
}

response = requests.get(url, headers=headers, params=querystring)
print("Status Code:", response.status_code)
print(response.json())
