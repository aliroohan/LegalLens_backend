// Standalone test script for RapidAPI Reverse Image Search
// Works with native Node.js fetch (Node 18+)
import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.RAPIDAPI_KEY;
const apiHost = process.env.RAPIDAPI_HOST || 'reverse-image-search1.p.rapidapi.com';

if (!apiKey) {
  console.error('Error: RAPIDAPI_KEY is not defined in .env');
  process.exit(1);
}

async function testReverseSearch() {
  const url = new URL('https://reverse-image-search1.p.rapidapi.com/reverse-image-search');
  url.searchParams.set('url', 'https://i.imgur.com/HBrB8p0.png');
  url.searchParams.set('limit', '10');
  url.searchParams.set('safe_search', 'blur');

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': apiHost
      }
    });

    const data = await response.json();
    console.log('Status Code:', response.status);
    console.log('Success! Matches found:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testReverseSearch();
