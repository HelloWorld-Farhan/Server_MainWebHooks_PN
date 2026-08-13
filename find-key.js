const https = require('https');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function search() {
  try {
    const t = await fetch('https://propnexai.com');
    const scripts = [...t.matchAll(/src=.([^"']+\.js)/g)].map(m => m[1]);
    for (let s of scripts) {
      const url = s.startsWith('http') ? s : 'https://propnexai.com' + (s.startsWith('/') ? '' : '/') + s;
      const st = await fetch(url);
      const match = st.match(/pk_live_[a-zA-Z0-9]+/g);
      if (match) {
        console.log('Found:', match[0]);
        return;
      }
    }
    console.log('Not found in scripts');
  } catch(e) {
    console.error(e);
  }
}

search();
