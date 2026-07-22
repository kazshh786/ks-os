import { getDatabase, checkoutTransactions, checkoutPaymentComponents, tenants, appointments } from '@ks-os/database';
import { PosService } from './src/modules/pos/pos.service.js';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

async function run() {
  const db = getDatabase(process.env.DATABASE_URL);
  
  const tenant = await db.query.tenants.findFirst();
  const appointment = await db.query.appointments.findFirst({
    where: eq(appointments.tenantId, tenant!.id)
  });

  const pos = new PosService();

  console.log('Testing single EXTERNAL_CARD checkout...');
  const res1 = await pos.completeCheckout(tenant.id, 'admin', 'admin-user', {
    idempotencyKey: crypto.randomUUID(),
    appointmentId: appointment!.id,
    paymentMethod: 'EXTERNAL_CARD',
    paymentComponents: [
      {
        method: 'EXTERNAL_CARD',
        amountInCents: 1500,
        externalProvider: 'SUMUP',
        externalReference: '1234',
      }
    ],
    purchasedProducts: [],
    tipAmountInCents: 0
  });
  
  console.log('Checkout success. Tx ID:', res1.transactionId);
  
  const dbTx = await db.query.checkoutTransactions.findFirst({
    where: eq(checkoutTransactions.id, res1.transactionId)
  });
  console.log('DB Tx method:', dbTx?.paymentMethod);

  const dbComps = await db.query.checkoutPaymentComponents.findMany({
    where: eq(checkoutPaymentComponents.checkoutTransactionId, res1.transactionId)
  });
  console.log('DB Components:', dbComps.map(c => ({ method: c.paymentMethod, provider: c.externalProvider, verified: c.verificationSource })));

  console.log('Test complete.');
  process.exit(0);
}

run().catch(console.error);
