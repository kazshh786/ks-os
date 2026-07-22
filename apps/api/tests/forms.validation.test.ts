import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { FormDraftInputSchema } from '@ks-os/contracts';
import { validateSubmission } from '../src/modules/forms/forms.validation.js';
import { hashFormToken } from '../src/modules/forms/forms.service.js';

const a=randomUUID(), b=randomUUID(), yes=randomUUID(), no=randomUUID();
const schema={fields:[{id:a,type:'SHORT_TEXT' as const,label:'Relevant history',required:true},{id:b,type:'SINGLE_CHOICE' as const,label:'Proceed?',required:true,options:[{id:yes,label:'Yes'},{id:no,label:'No'}]}]};
test('form schema rejects duplicate field IDs and executable markup',()=>{assert.throws(()=>FormDraftInputSchema.parse({title:'Test',description:'',acknowledgementText:'Read',schema:{fields:[schema.fields[0],schema.fields[0]]}}));assert.throws(()=>FormDraftInputSchema.parse({title:'<script>alert(1)</script>',description:'',acknowledgementText:'Read',schema}));});
test('submission validates required, unknown, type and option IDs',()=>{const base={acknowledgement:{accepted:true as const,name:'Test Person'},idempotencyKey:randomUUID()};assert.doesNotThrow(()=>validateSubmission(schema,{...base,answers:{[a]:'None',[b]:yes}}));assert.throws(()=>validateSubmission(schema,{...base,answers:{[b]:yes}}),(e:any)=>e.code==='FORM_REQUIRED_ANSWER_MISSING');assert.throws(()=>validateSubmission(schema,{...base,answers:{[a]:'None',[b]:randomUUID()}}),(e:any)=>e.code==='FORM_ANSWER_TYPE_INVALID');assert.throws(()=>validateSubmission(schema,{...base,answers:{[a]:'None',[b]:yes,[randomUUID()]:'x'}}),(e:any)=>e.code==='FORM_UNKNOWN_ANSWER');});
test('public token hashes are deterministic and never preserve the raw token',()=>{const token='a'.repeat(43);const hash=hashFormToken(token);assert.equal(hash.length,64);assert.notEqual(hash,token);assert.equal(hash,hashFormToken(token));});
