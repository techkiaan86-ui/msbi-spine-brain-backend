const https = require('https');

const endpoints = [
  'https://midwestspine.net/wp-json/wp/v2/posts?per_page=100&_embed=1',
  'https://midwestspine.net/wp-json/wp/v2/pages?per_page=100&_embed=1',
  'https://midwestspine.net/wp-json/wp/v2/media?per_page=100',
  'https://midwestspine.net/wp-json/wp/v2/categories?per_page=100',
  'https://midwestspine.net/wp-json/wp/v2/tags?per_page=100',
  'https://midwestspine.net/wp-json/wp/v2/condition_treatments?per_page=100&_embed=1',
  'https://midwestspine.net/wp-json/wp/v2/types',
  'https://midwestspine.net/wp-json/wp/v2/taxonomies'
];

async function fetchEndpoint(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const totalPages = res.headers['x-wp-totalpages'];
          const totalRecords = res.headers['x-wp-total'];
          const count = Array.isArray(json) ? json.length : Object.keys(json).length;
          
          resolve({
            url,
            status: res.statusCode,
            returnedData: !!json,
            count,
            totalRecords: totalRecords || (Array.isArray(json) ? json.length : Object.keys(json).length),
            paginationSupport: !!totalPages,
            error: null
          });
        } catch (e) {
          resolve({ url, status: res.statusCode, returnedData: false, count: 0, error: e.message });
        }
      });
    }).on('error', (e) => {
      resolve({ url, status: 0, returnedData: false, count: 0, error: e.message });
    });
  });
}

async function run() {
  const results = [];
  for (const url of endpoints) {
    const res = await fetchEndpoint(url);
    results.push(res);
    console.log(res);
  }
}
run();
