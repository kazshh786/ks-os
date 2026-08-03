import assert from 'node:assert/strict';
import test from 'node:test';
import {
  modeToPaymentPolicy,
  paymentPolicyToMode,
  splitBusinessAddress,
} from '../src/routes/workspace-profile.helpers.js';

test('workspace payment policies map to persistent modes', () => {
  assert.equal(paymentPolicyToMode('PayLater'), 'pay_later');
  assert.equal(paymentPolicyToMode('NoPayment'), 'pay_later');
  assert.equal(paymentPolicyToMode('Deposit'), 'deposit');
  assert.equal(paymentPolicyToMode('FullPayment'), 'full_payment');
  assert.equal(paymentPolicyToMode('CustomerChoice'), 'customer_choice');
  assert.equal(modeToPaymentPolicy('deposit'), 'Deposit');
  assert.equal(modeToPaymentPolicy('full_payment'), 'FullPayment');
  assert.equal(modeToPaymentPolicy('customer_choice'), 'CustomerChoice');
  assert.equal(modeToPaymentPolicy('pay_later'), 'PayLater');
});

test('workspace address separates a UK postcode for the primary location', () => {
  assert.deepEqual(splitBusinessAddress('12 High Street, Keighley, BD21 3AA'), {
    address: '12 High Street, Keighley',
    postcode: 'BD21 3AA',
  });
  assert.deepEqual(splitBusinessAddress('12 High Street, Keighley'), {
    address: '12 High Street, Keighley',
    postcode: '',
  });
  assert.deepEqual(splitBusinessAddress(''), { address: '', postcode: '' });
});
