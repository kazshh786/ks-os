const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Manually parse .env.local file to find DATABASE_URL
let dbUrl = '';
try {
  const envPath = path.join(__dirname, '..', '.env.local');
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/DATABASE_URL=(.+)/);
  if (match) {
    dbUrl = match[1].trim();
  }
} catch (err) {
  console.error('Failed to read .env.local file:', err.message);
  process.exit(1);
}

if (!dbUrl) {
  console.error('DATABASE_URL connection string not found in .env.local');
  process.exit(1);
}

const client = new Client({
  connectionString: dbUrl,
});

async function main() {
  await client.connect();
  console.log('Connected to Supabase PostgreSQL database.');

  // Clean up any lingering duplicate entries in auth.users from manual SQL inserts
  // to prevent email duplication errors
  await client.query("DELETE FROM auth.users WHERE email = 'kasimashah@gmail.com';");
  console.log('Cleared out manual duplicate entries from auth.users.');

  // 1. Create the KS Studio Agency tenant if not present
  await client.query(`
    INSERT INTO public.tenants (id, name, subdomain, primary_color, secondary_color, accent_color)
    VALUES (
      '00000000-0000-0000-0000-000000000000', 
      'KS Studio Agency', 
      'agency', 
      '#0f172a', 
      '#475569', 
      '#10b981'
    )
    ON CONFLICT (id) DO NOTHING;
  `);
  console.log('Ensured KS Studio Agency tenant is created in tenants table.');

  // 2. Link your GUI-created user ID to public.users profile
  const userId = '53530d9e-8c12-4e2f-982e-3a8e18c497cb';
  await client.query(`
    INSERT INTO public.users (id, tenant_id, email, name, role, permissions)
    VALUES (
      $1,
      '00000000-0000-0000-0000-000000000000',
      'kasimashah@gmail.com',
      'Master Agency Admin',
      'owner',
      '{"admin": true, "requires_password_change": true}'::jsonb
    )
    ON CONFLICT (id) DO UPDATE 
    SET permissions = '{"admin": true, "requires_password_change": true}'::jsonb;
  `, [userId]);

  console.log('Successfully mapped Supabase Auth UUID to public.users database profile!');
  await client.end();
}

main().catch((err) => {
  console.error('Error running seeding script:', err);
  process.exit(1);
});
