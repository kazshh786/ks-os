import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';
const migration=readFileSync(new URL('../../../packages/database/migrations/20260905120000_business_profile_foundation.sql',import.meta.url),'utf8');
test('additive profile migration is idempotent and preserves legacy tenant values',{skip:!process.env.DATABASE_URL},async()=>{
  const client=new pg.Client({connectionString:process.env.DATABASE_URL});
  await client.connect();
  try{
    await client.query('BEGIN');
    // A temporary table shadows production names on this connection only.
    await client.query('CREATE TEMP TABLE tenants (id text PRIMARY KEY, business_type text) ON COMMIT DROP');
    await client.query("INSERT INTO tenants VALUES ('legacy','Unmapped specialist'),('salon','Hair salon')");
    await client.query(migration);
    await client.query(migration);
    const rows=(await client.query('SELECT id,business_type,business_profile FROM tenants ORDER BY id')).rows;
    assert.deepEqual(rows,[{id:'legacy',business_type:'Unmapped specialist',business_profile:null},{id:'salon',business_type:'Hair salon',business_profile:null}]);
  }finally{await client.query('ROLLBACK');await client.end();}
});
