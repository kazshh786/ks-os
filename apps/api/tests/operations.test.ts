import test from 'node:test';
import assert from 'node:assert/strict';
import {AssignOperationsIssueSchema,OperationsIssueListQuerySchema,OperationsIssueSchema} from '@ks-os/contracts';
import {operationsDeduplicationKey} from '../src/modules/operations/operations.issue-service.js';
test('operations queries are bounded and reject unknown status values',()=>{assert.equal(OperationsIssueListQuerySchema.parse({limit:'30'}).limit,30);assert.throws(()=>OperationsIssueListQuerySchema.parse({limit:101}));assert.throws(()=>OperationsIssueListQuerySchema.parse({status:'PENDING'}));});
test('assignment input is strict and tenant identity cannot be supplied',()=>{assert.deepEqual(AssignOperationsIssueSchema.parse({assignedToUserId:null}),{assignedToUserId:null});assert.throws(()=>AssignOperationsIssueSchema.parse({assignedToUserId:null,tenantId:'11111111-1111-4111-8111-111111111111'}));});
test('deduplication is stable per issue type and source',()=>{assert.equal(operationsDeduplicationKey('EMAIL_FAILED','source-1'),'EMAIL_FAILED:source-1');assert.notEqual(operationsDeduplicationKey('EMAIL_BOUNCED','source-1'),operationsDeduplicationKey('EMAIL_FAILED','source-1'));});
test('issue response requires the complete strict lifecycle shape',()=>{assert.equal(OperationsIssueSchema.safeParse({}).success,false);});
