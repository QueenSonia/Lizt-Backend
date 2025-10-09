const { config } = require('dotenv-flow');
config({ default_node_env: 'production' });

const keys = ['PROD_PORT', 'PROD_DB_NAME', 'PROD_DB_HOST', 'PROD_DB_PASSWORD', 'PROD_DB_USERNAME', 'NODE_ENV'];

keys.forEach((k) => {
  const v = process.env[k];
  console.log(k, '=>', v);
  console.log('  typeof:', typeof v);
  try {
    console.log('  JSON:', JSON.stringify(v));
  } catch (e) {
    console.log('  JSON stringify error:', e.message);
  }
});

// also show raw .env lines for context (best-effort)
const fs = require('fs');
try {
  const env = fs.readFileSync('.env', 'utf8');
  console.log('\n-- .env preview (lines including PROD_) --');
  env.split('\n').filter(l => l.includes('PROD_')).forEach(l => console.log(l));
} catch (e) {
  console.error('Could not read .env:', e.message);
}
