import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ChangeWorkStatusSchema,
  CreateTaskSchema,
  CreateWorkItemSchema,
  CreateWorkTaskSchema,
  defaultWorkTypeForBusinessType,
  MODULE_REGISTRY,
  resolveBusinessProfile,
  TaskListQuerySchema,
  TaskSummarySchema,
} from '@ks-os/contracts';
import { effectiveCapabilities } from '@ks-os/auth';

const uuid = '11111111-1111-4111-8111-111111111111';

test('work type defaults follow the business operating model', () => {
  assert.equal(defaultWorkTypeForBusinessType('PLUMBING'), 'JOB');
  assert.equal(defaultWorkTypeForBusinessType('AGENCY'), 'PROJECT');
  assert.equal(defaultWorkTypeForBusinessType('LOGISTICS_COURIER'), 'DELIVERY');
  assert.equal(defaultWorkTypeForBusinessType('PROFESSIONAL_SERVICES'), 'CASE');
  assert.equal(defaultWorkTypeForBusinessType('ECOMMERCE'), 'ORDER');
  assert.equal(defaultWorkTypeForBusinessType('something custom'), 'JOB');
});

test('work contracts reject invalid schedules and require bounded input', () => {
  assert.equal(CreateWorkItemSchema.safeParse({ title: 'Boiler replacement' }).success, true);
  assert.equal(CreateWorkItemSchema.safeParse({ title: 'x' }).success, false);
  assert.equal(CreateWorkItemSchema.safeParse({
    title: 'Delivery',
    scheduledStartAt: '2026-09-06T12:00:00.000Z',
    scheduledEndAt: '2026-09-06T11:00:00.000Z',
  }).success, false);
  assert.equal(CreateWorkTaskSchema.safeParse({ title: 'Take completion photos' }).success, true);
  assert.equal(ChangeWorkStatusSchema.safeParse({ status: 'BLOCKED', reason: 'Waiting for parts' }).success, true);
});

test('work is an implemented profile module with business terminology', () => {
  assert.equal(MODULE_REGISTRY.work.status, 'implemented');
  assert.equal(MODULE_REGISTRY.work.route, '/app/work');
  assert.deepEqual(MODULE_REGISTRY.work.capabilities, ['WORK_VIEW_OWN', 'WORK_VIEW_ALL']);

  const plumber = resolveBusinessProfile('PLUMBING');
  assert.ok(plumber.enabledModules.includes('work'));
  assert.equal(plumber.terminology.work, 'Job');
  assert.equal(plumber.terminology.works, 'Jobs');

  const agency = resolveBusinessProfile('AGENCY');
  assert.ok(agency.enabledModules.includes('work'));
  assert.equal(agency.terminology.works, 'Projects');

  const logistics = resolveBusinessProfile('LOGISTICS_COURIER');
  assert.ok(logistics.enabledModules.includes('work'));
  assert.equal(logistics.terminology.works, 'Deliveries');

  assert.equal(resolveBusinessProfile('SALON_BARBER').enabledModules.includes('work'), false);
});

test('project onboarding resolves to the universal work engine rather than a fake planned route', () => {
  const profile = resolveBusinessProfile('AGENCY', {
    version: 1,
    completedAt: '2026-09-06T00:00:00.000Z',
    answers: {
      businessName: 'Studio', businessType: 'AGENCY', teamSize: '2-5',
      buying: ['quotes'], delivery: ['projects'], resources: ['staff'], payment: ['invoices'],
      manage: ['customers', 'projects', 'staff'],
    },
  });
  assert.ok(profile.enabledModules.includes('work'));
  assert.equal(profile.enabledModules.includes('projects'), false);
});

test('existing access profile architecture grants bounded work capabilities', () => {
  const practitioner = effectiveCapabilities('staff', 'PRACTITIONER', {});
  assert.ok(practitioner.includes('WORK_VIEW_OWN'));
  assert.ok(practitioner.includes('WORK_CREATE'));
  assert.ok(practitioner.includes('WORK_COMPLETE_OWN'));
  assert.ok(!practitioner.includes('WORK_ASSIGN'));

  const manager = effectiveCapabilities('staff', 'MANAGER', {});
  assert.ok(manager.includes('WORK_VIEW_ALL'));
  assert.ok(manager.includes('WORK_ASSIGN'));
  assert.ok(manager.includes('WORK_COMPLETE_ALL'));
  assert.ok(effectiveCapabilities('owner').includes('WORK_UPDATE_ALL'));
});

test('WORK_ITEM task sources are readable/filterable but cannot be forged via generic task creation', () => {
  assert.equal(TaskListQuerySchema.safeParse({ sourceType: 'WORK_ITEM' }).success, true);
  assert.equal(CreateTaskSchema.safeParse({ title: 'Forged work task', sourceType: 'WORK_ITEM', sourceId: uuid }).success, false);
  assert.equal(TaskSummarySchema.safeParse({
    id: uuid, title: 'Linked task', status: 'OPEN', priority: 'NORMAL', dueAt: null, overdue: false,
    tenantTimezone: 'Europe/London', assignedUser: null, sourceType: 'WORK_ITEM', appointmentId: null,
    clientId: null, operationsIssueId: null, createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z',
  }).success, true);
});
