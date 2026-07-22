import test from 'node:test';import assert from 'node:assert/strict';import {normalizeSmsPhone,maskPhone} from '../src/modules/sms/phone.js';
test('normalises a UK mobile to E.164',()=>assert.equal(normalizeSmsPhone('07123 456789'),'+447123456789'));
test('rejects an invalid or UK landline recipient',()=>{assert.throws(()=>normalizeSmsPhone('not a number'),/SMS_RECIPIENT_INVALID/);assert.throws(()=>normalizeSmsPhone('020 7946 0958'),/SMS_RECIPIENT_INVALID/)});
test('accepts explicit international E.164',()=>assert.equal(normalizeSmsPhone('+14155552671'),'+14155552671'));
test('masks history recipients',()=>assert.equal(maskPhone('+447123456789'),'+44 •••• ••• 789'));
