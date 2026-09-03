const axios = require('axios');

async function check() {
  const base = 'https://msbi-spine-brain-backend-production.up.railway.app/api/v1';
  const urls = [
    '/health',
    '/integrations/wordpress/health',
    '/integrations/wordpress/posts?page=1&per_page=5',
    '/integrations/wordpress/pages?page=1&per_page=5',
    '/integrations/wordpress/media?page=1&per_page=5',
    '/integrations/wordpress/categories?page=1&per_page=5',
    '/integrations/wordpress/tags?page=1&per_page=5',
    '/integrations/wordpress/types',
    '/integrations/wordpress/taxonomies',
    '/integrations/wordpress/condition-treatments?page=1&per_page=5',
  ];

  for (const path of urls) {
    try {
      const res = await axios.get(base + path);
      console.log(`${path}: ${res.status}`);
    } catch (err) {
      if (err.response) {
        console.log(`${path}: ${err.response.status}`);
      } else {
        console.log(`${path}: ERROR ${err.message}`);
      }
    }
  }
}

check();
