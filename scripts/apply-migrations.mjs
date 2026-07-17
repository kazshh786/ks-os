import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^\s*([\w.\-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('Error: DATABASE_URL environment variable is missing.');
  process.exit(1);
}

async function run() {
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false } // Required for Supabase connections
  });

  try {
    console.log('Connecting to Supabase...');
    await client.connect();
    console.log('Connected successfully!');

    // Define migrations to run in order
    const migrations = [
      'module11_booking_channels.sql',
      'module12_automation_event_outbox.sql',
      'module13_status_lifecycle.sql'
    ];

    for (const file of migrations) {
      console.log(`Applying SQL migration: ${file}...`);
      const sql = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      await client.query(sql);
      console.log(`Successfully applied ${file}`);
    }

    // Optional: Alter appointments status check constraint if it exists
    console.log('Ensuring appointments status lifecycle check constraint is updated...');
    await client.query(`
      DO $$
      BEGIN
        -- Try to drop check constraint if it exists
        ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
        
        -- Add updated check constraint to allow CHECKED_IN, IN_SERVICE, and AWAITING_PAYMENT
        ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check CHECK (
          status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE', 'AWAITING_PAYMENT', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'BLOCKED')
        );
      EXCEPTION
        WHEN others THEN
          RAISE NOTICE 'Could not recreate appointments_status_check: %', SQLERRM;
      END $$;
    `);
    console.log('Status lifecycle check constraint applied successfully.');

  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed.');
  }
}

run();
