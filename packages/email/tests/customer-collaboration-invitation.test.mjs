import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEmail } from '../dist/index.js';
test('customer collaboration invitation explains verified-email access and has a plain-text alternative',async()=>{
  const {html,text}=await renderEmail('customer-collaboration-invitation',{tenantName:'A & B',channelName:'Customer <private>',invitationUrl:'https://portal.example.test/customer/invite#invite=test',expiresLabel:'2026-10-30T12:00:00Z'});
  assert.match(text,/email address that received this invitation/i);
  assert.match(text,/Accept customer invitation/i);
  assert.match(text,/Forwarding it does not give another email address access/i);
  assert.match(html,/lang="en"/);
  assert.ok(html.includes('&lt;private&gt;'));
  assert.ok(!html.includes('<private>'));
});
