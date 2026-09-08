import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

test('booking recipient migration isolates shared phones and preserves email identity in both overloads', { skip: !process.env.BOOKING_INTEGRITY_TEST_DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.BOOKING_INTEGRITY_TEST_DATABASE_URL });
  const db = await pool.connect();
  const schema = `email_identity_${Date.now()}`;
  try {
    await db.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema};
      CREATE TABLE clients(id integer GENERATED ALWAYS AS IDENTITY, tenant_id text, name text, email text, phone text, created_at timestamptz DEFAULT now());`);
    const migration = (await readFile(new URL('../../../packages/database/migrations/20260908055223_booking_customer_email_identity.sql', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
    const lookup = migration.split('$old$')[1];
    for (const extra of ['', ', unused boolean']) {
      await db.query(`CREATE FUNCTION ${schema}.create_public_booking(p_tenant_id text, p_client_email text, p_client_phone text${extra}) RETURNS integer LANGUAGE plpgsql AS $fn$
DECLARE v_client_id integer;
BEGIN
${lookup}
  IF v_client_id IS NULL THEN
    INSERT INTO clients(tenant_id,email,phone) VALUES (p_tenant_id,nullif(p_client_email, ''),nullif(p_client_phone, '')) RETURNING id INTO v_client_id;
  END IF;
  RETURN v_client_id;
END;$fn$;`);
    }
    await db.query(migration.replace("n.nspname = 'public'", `n.nspname = '${schema}'`));
    await db.query("INSERT INTO clients(tenant_id,email,phone) VALUES ('a','original@example.test','123'),('b','customer@example.test','123')");
    for (const extra of ['', ', true']) {
      const book = async (email: string, phone: string) => (await db.query(`SELECT create_public_booking('a',$1,$2${extra}) AS id`, [email,phone])).rows[0].id;
      const customer = await book('customer@example.test','123');
      assert.notEqual(customer,1, 'shared phone must not select original email');
      assert.notEqual(customer,2, 'email match must stay inside tenant');
      assert.equal(await book(' CUSTOMER@example.test ','456'),customer, 'normalized email wins over changed phone');
      assert.equal(await book('original@example.test','456'),1);
      const noEmail = await book('','123');
      assert.notEqual(noEmail,1, 'missing email cannot inherit another customer email');
      assert.notEqual(noEmail,customer);
      assert.equal(await book('   ','123'),noEmail);
    }
    const rows = (await db.query('SELECT email FROM clients ORDER BY id')).rows;
    assert.equal(rows[0].email,'original@example.test');
    assert.equal(rows[1].email,'customer@example.test');
    assert.equal(rows[2].email,'customer@example.test');
    assert.equal(rows[3].email,null);
  } finally {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    db.release(); await pool.end();
  }
});
