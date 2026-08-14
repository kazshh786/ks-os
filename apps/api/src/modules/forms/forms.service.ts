import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, inArray, max, sql } from 'drizzle-orm';
import { appointments, clientFormSubmissions, clients, customerClientLinks, emailOutbox, formAssignments, forms, formVersions, getDatabase, smsOutbox, tenants } from '@ks-os/database';
import { FormDraftInputSchema, FormSchemaJsonSchema, type CreateFormAssignmentInput, type PublicFormSubmission } from '@ks-os/contracts';
import { renderAnswers, validateSubmission } from './forms.validation.js';
import { SmsService } from '../sms/sms.service.js';
import { EmailService } from '../email/email.service.js';
import { EmailSettingsService, emailBrandingTemplateData } from '../email/email-settings.service.js';
import { env } from '../../config/env.js';
import { buildSecureFormUrl, formReminderScheduledFor, shouldQueueFormAssignmentEmail, shouldQueueFormReminder } from './form-delivery.js';
import { BusinessEventsService, stableEventId } from '../automations/business-events.service.js';

type Actor = { tenantId: string; userId: string; role: 'owner' | 'staff' };
const err = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
export const hashFormToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const legacyForm = (row: any) => ({
  id: row.id,
  tenantId: row.tenant_id,
  title: row.title,
  description: row.description || '',
  internalDescription: '',
  formType: 'CUSTOM',
  fieldsJson: row.fields_json,
  acknowledgementText: row.acknowledgement_text || '',
  status: row.status,
  createdByUserId: row.created_by_user_id,
  updatedByUserId: row.created_by_user_id,
  defaultLanguage: 'en-GB',
  supportedLanguages: ['en-GB'],
  settings: row.fields_json?.settings || {},
  themeJson: row.fields_json?.theme || {},
  draftRevision: 1,
  publishedVersionId: null,
  archivedAt: row.archived_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class FormsService {
  private db = getDatabase();
  private businessEvents = new BusinessEventsService();
  private email = new EmailService();
  private emailSettings = new EmailSettingsService();

  async listForms(actor: Actor) {
    const statusScope = actor.role === 'owner' ? undefined : eq(forms.status, 'PUBLISHED');
    return this.db.select({ id: forms.id, title: forms.title, description: forms.description, status: forms.status, updatedAt: forms.updatedAt,
      latestVersion: sql<number>`coalesce(max(${formVersions.versionNumber}), 0)::int`, assignmentCount: sql<number>`count(distinct ${formAssignments.id})::int`, submissionCount: sql<number>`count(distinct ${clientFormSubmissions.id})::int` })
      .from(forms).leftJoin(formVersions, and(eq(formVersions.formId, forms.id), eq(formVersions.tenantId, actor.tenantId)))
      .leftJoin(formAssignments, and(eq(formAssignments.formId, forms.id), eq(formAssignments.tenantId, actor.tenantId)))
      .leftJoin(clientFormSubmissions, and(eq(clientFormSubmissions.formId, forms.id), eq(clientFormSubmissions.tenantId, actor.tenantId)))
      .where(and(eq(forms.tenantId, actor.tenantId), statusScope)).groupBy(forms.id).orderBy(desc(forms.updatedAt));
  }

  async getForm(actor: Actor, formId: string) {
    const result = await this.db.execute(sql`
      select id, tenant_id, title, description, fields_json, acknowledgement_text, status,
        created_by_user_id, archived_at, created_at, updated_at
      from forms
      where id=${formId}::uuid and tenant_id=${actor.tenantId}::uuid
        ${actor.role === 'staff' ? sql`and status='PUBLISHED'` : sql``}
      limit 1
    `);
    const form = result.rows[0] ? legacyForm(result.rows[0]) : undefined;
    if (!form) throw err(404, 'FORM_NOT_FOUND', 'Form not found.');
    return form;
  }

  async create(actor: Actor, value: unknown) {
    this.owner(actor); const input = FormDraftInputSchema.parse(value);
    const result = await this.db.execute(sql`
      insert into forms (tenant_id, title, description, fields_json, acknowledgement_text, status, created_by_user_id)
      values (${actor.tenantId}::uuid, ${input.title}, ${input.description}, ${JSON.stringify(input.schema)}::jsonb, ${input.acknowledgementText}, 'DRAFT', ${actor.userId}::uuid)
      returning id, tenant_id, title, description, fields_json, acknowledgement_text, status,
        created_by_user_id, archived_at, created_at, updated_at
    `);
    return legacyForm(result.rows[0]);
  }

  async update(actor: Actor, formId: string, value: unknown) {
    this.owner(actor); const input = FormDraftInputSchema.parse(value);
    const result = await this.db.execute(sql`
      update forms set title=${input.title}, description=${input.description},
        fields_json=${JSON.stringify(input.schema)}::jsonb, acknowledgement_text=${input.acknowledgementText}, updated_at=now()
      where id=${formId}::uuid and tenant_id=${actor.tenantId}::uuid and status in ('DRAFT','PUBLISHED','UNPUBLISHED')
      returning id, tenant_id, title, description, fields_json, acknowledgement_text, status,
        created_by_user_id, archived_at, created_at, updated_at
    `);
    const updated = result.rows[0] ? legacyForm(result.rows[0]) : undefined;
    if (!updated) throw err(409, 'FORM_DRAFT_CONFLICT', 'This draft changed in another session. Reload before saving again.');
    return updated;
  }

  async publish(actor: Actor, formId: string) {
    this.owner(actor);
    return this.db.transaction(async (tx) => {
      const formResult = await tx.execute(sql`select id,tenant_id,title,description,fields_json,acknowledgement_text,status from forms where id=${formId}::uuid and tenant_id=${actor.tenantId}::uuid and status in ('DRAFT','PUBLISHED','UNPUBLISHED') for update`);
      const form = formResult.rows[0] as any;
      if (!form) throw err(409, 'FORM_VERSION_IMMUTABLE', 'This form cannot be published.');
      const schema = FormSchemaJsonSchema.parse(form.fields_json);
      if (!form.acknowledgement_text.trim()) throw err(400, 'FORM_INVALID_SCHEMA', 'Acknowledgement text is required before publication.');
      const latest = await tx.execute(sql`select coalesce(max(version_number),0)::int value from form_versions where form_id=${formId}::uuid and tenant_id=${actor.tenantId}::uuid`);
      const versionResult = await tx.execute(sql`
        insert into form_versions (tenant_id,form_id,version_number,title_snapshot,description_snapshot,schema_json,acknowledgement_text,created_by_user_id)
        values (${actor.tenantId}::uuid,${formId}::uuid,${Number((latest.rows[0] as any)?.value || 0) + 1},${form.title},${form.description || ''},${JSON.stringify(schema)}::jsonb,${form.acknowledgement_text},${actor.userId}::uuid)
        returning id,tenant_id,form_id,version_number,title_snapshot,description_snapshot,schema_json,acknowledgement_text,created_by_user_id,created_at,published_at
      `);
      const version = versionResult.rows[0];
      await tx.execute(sql`update forms set status='PUBLISHED',updated_at=now() where id=${formId}::uuid and tenant_id=${actor.tenantId}::uuid`);
      return version;
    });
  }

  async archive(actor: Actor, formId: string) { this.owner(actor); const [row] = await this.db.update(forms).set({ status: 'ARCHIVED', archivedAt: new Date(), updatedAt: new Date() }).where(and(eq(forms.id, formId), eq(forms.tenantId, actor.tenantId))).returning({ id: forms.id }); if (!row) throw err(404,'FORM_NOT_FOUND','Form not found.'); }
  async listVersions(actor: Actor, formId: string) { await this.getForm(actor, formId); const result=await this.db.execute(sql`select id,tenant_id "tenantId",form_id "formId",version_number "versionNumber",title_snapshot "titleSnapshot",description_snapshot "descriptionSnapshot",schema_json "schemaJson",acknowledgement_text "acknowledgementText",created_by_user_id "createdByUserId",created_at "createdAt",published_at "publishedAt" from form_versions where form_id=${formId}::uuid and tenant_id=${actor.tenantId}::uuid order by version_number desc`); return result.rows; }
  async getVersion(actor: Actor, formId: string, versionId: string) { const result=await this.db.execute(sql`select id,tenant_id "tenantId",form_id "formId",version_number "versionNumber",title_snapshot "titleSnapshot",description_snapshot "descriptionSnapshot",schema_json "schemaJson",acknowledgement_text "acknowledgementText",created_by_user_id "createdByUserId",created_at "createdAt",published_at "publishedAt" from form_versions where id=${versionId}::uuid and form_id=${formId}::uuid and tenant_id=${actor.tenantId}::uuid limit 1`);const row=result.rows[0]; if (!row) throw err(404,'FORM_VERSION_NOT_FOUND','Form version not found.'); return row; }

  async createAssignment(actor: Actor, input: CreateFormAssignmentInput, expiryDays: number) {
    if (actor.role === 'staff' && !input.appointmentId) throw err(403,'FORM_ACCESS_DENIED','Staff assignments require one of your appointments.');
    const token = newToken();
    const assignment = await this.db.transaction(async (tx) => {
      const [client] = await tx.select().from(clients).where(and(eq(clients.id,input.clientId),eq(clients.tenantId,actor.tenantId))).limit(1);
      if (!client) throw err(404,'FORM_ASSIGNMENT_NOT_FOUND','Assignment target not found.');
      if (input.appointmentId) { const [appt] = await tx.select({ id: appointments.id, userId: appointments.userId }).from(appointments).where(and(eq(appointments.id,input.appointmentId),eq(appointments.clientId,input.clientId),eq(appointments.tenantId,actor.tenantId))).limit(1); if (!appt) throw err(404,'FORM_ASSIGNMENT_NOT_FOUND','Assignment target not found.'); if (actor.role === 'staff' && appt.userId !== actor.userId) throw err(403,'FORM_ACCESS_DENIED','You cannot assign forms for this appointment.'); }
      const versionResult = await tx.execute(sql`
        select v.id, v.title_snapshot, v.description_snapshot, v.schema_json
        from form_versions v
        join forms f on f.id=v.form_id and f.tenant_id=v.tenant_id
        where v.form_id=${input.formId}::uuid
          and v.tenant_id=${actor.tenantId}::uuid
          and f.status<>'ARCHIVED'
          ${input.formVersionId ? sql`and v.id=${input.formVersionId}::uuid` : sql``}
        order by v.version_number desc
        limit 1
      `);
      const version = versionResult.rows[0] as { id:string; title_snapshot:string; description_snapshot:string | null; schema_json:unknown } | undefined;
      if (!version) throw err(409,'FORM_NOT_PUBLISHED','A published form version is required.');
      const expiresAt = new Date(Date.now() + expiryDays * 86400000);
      const [created] = await tx.insert(formAssignments).values({ tenantId: actor.tenantId, formId: input.formId, formVersionId: version.id, clientId: input.clientId, appointmentId: input.appointmentId, publicTokenHash: hashFormToken(token), expiresAt, assignedByUserId: actor.userId }).returning();
      await this.businessEvents.emit({id:stableEventId('FORM_ASSIGNED',created.id,'created'),tenantId:actor.tenantId,type:'FORM_ASSIGNED',occurredAt:new Date().toISOString(),sourceType:'form_assignment',sourceId:created.id,payload:{assignmentId:created.id,formId:created.formId,appointmentId:created.appointmentId,status:'PENDING'}},tx);
      const [tenant]=await tx.select().from(tenants).where(eq(tenants.id,actor.tenantId)).limit(1);
      const secureUrl = buildSecureFormUrl(env.PUBLIC_APP_ORIGIN, token);
      if (input.deliveryMethod === 'SMS' && client.phone) {
        if (tenant?.smsEnabled && tenant.smsFormDeliveryEnabled && secureUrl) {
          await new SmsService().enqueue({
            tenantId: actor.tenantId,
            clientId: client.id,
            appointmentId: input.appointmentId,
            formAssignmentId: created.id,
            recipientPhone: client.phone,
            templateKey: 'form-assigned',
            templateData: { formTitle: version.title_snapshot, secureUrl },
            idempotencyKey: `sms-form-${created.id}`,
            validUntil: expiresAt,
          }, tx);
        }
      }

      const recipientEmail = client.email || undefined;
      if (
        input.deliveryMethod === 'EMAIL'
        && shouldQueueFormAssignmentEmail({
          deliveryMethod: input.deliveryMethod,
          recipientEmail,
          formDeliveryEnabled: tenant?.formDeliveryEnabled,
          secureUrl,
        })
      ) {
        const settings = await this.emailSettings.get(actor.tenantId, tx);
        const formSchema = FormSchemaJsonSchema.safeParse(version.schema_json);
        const estimatedMinutes = formSchema.success ? formSchema.data.settings.estimatedMinutes : undefined;
        let appointmentStart: Date | undefined;
        let appointmentTemplateData: Record<string, string> = {};

        if (input.appointmentId) {
          const appointmentResult = await tx.execute(sql`
            select a.start_time "startTime", s.name "serviceName", u.name "staffName", l.name "locationName"
            from appointments a
            left join services s on s.id=a.service_id and s.tenant_id=a.tenant_id
            left join users u on u.id=a.user_id and u.tenant_id=a.tenant_id
            left join locations l on l.id=a.location_id and l.tenant_id=a.tenant_id
            where a.id=${input.appointmentId}::uuid and a.tenant_id=${actor.tenantId}::uuid
            limit 1
          `);
          const appointment = appointmentResult.rows[0] as {
            startTime?: Date | string;
            serviceName?: string | null;
            staffName?: string | null;
            locationName?: string | null;
          } | undefined;
          if (appointment?.startTime) {
            const parsedAppointmentStart = new Date(appointment.startTime);
            if (Number.isFinite(parsedAppointmentStart.getTime())) {
              appointmentStart = parsedAppointmentStart;
              const appointmentDate = new Intl.DateTimeFormat('en-GB', {
                dateStyle: 'full',
                timeZone: tenant?.timezone || 'Europe/London',
              }).format(parsedAppointmentStart);
              appointmentTemplateData = {
                appointmentDate,
                appointmentTime: new Intl.DateTimeFormat('en-GB', {
                  timeStyle: 'short',
                  timeZone: tenant?.timezone || 'Europe/London',
                }).format(parsedAppointmentStart),
                appointmentDateTime: parsedAppointmentStart.toISOString(),
                dueDate: appointmentDate,
                ...(appointment.serviceName ? { serviceName: appointment.serviceName } : {}),
                ...(appointment.staffName ? { staffName: appointment.staffName } : {}),
                ...(appointment.locationName ? { locationName: appointment.locationName } : {}),
              };
            }
          }
        }

        const formName = version.title_snapshot;
        const commonTemplateData = {
          ...emailBrandingTemplateData(settings.branding),
          tenantPrimaryColor: tenant!.primaryColor,
          customerName: client.name,
          formName,
          formLink: secureUrl!,
          timezone: tenant!.timezone,
          ...(version.description_snapshot ? { formDescription: version.description_snapshot } : {}),
          ...(estimatedMinutes ? { estimatedMinutes } : {}),
          ...appointmentTemplateData,
        };
        await this.email.enqueueEmail({
          tenantId: actor.tenantId,
          recipientEmail: recipientEmail!,
          recipientName: client.name,
          replyToEmail: settings.replyToEmail || undefined,
          templateKey: 'form-assigned',
          templateDataJson: {
            ...commonTemplateData,
            emailSubject: ('Action required: complete your ' + formName).slice(0, 160),
          },
          idempotencyKey: `form-assigned-email:${created.id}`,
          relatedEntityType: 'form_assignment',
          relatedEntityId: created.id,
        }, tx);

        const scheduledFor = formReminderScheduledFor(
          settings.formReminderTiming,
          created.createdAt || new Date(),
          appointmentStart,
        );
        if (shouldQueueFormReminder({
          deliveryMethod: input.deliveryMethod,
          recipientEmail,
          formDeliveryEnabled: settings.formDeliveryEnabled,
          formRemindersEnabled: settings.formRemindersEnabled,
          secureUrl,
          scheduledFor,
          expiresAt,
        })) {
          const reminderSubject = appointmentStart
            ? 'One form to complete before your appointment — ' + settings.branding.businessName
            : 'Reminder: ' + formName + ' still needs completing';
          await this.email.enqueueEmail({
            tenantId: actor.tenantId,
            recipientEmail: recipientEmail!,
            recipientName: client.name,
            replyToEmail: settings.replyToEmail || undefined,
            templateKey: 'form-reminder',
            templateDataJson: {
              ...commonTemplateData,
              emailSubject: reminderSubject.slice(0, 160),
            },
            idempotencyKey: `form-reminder-email:${created.id}:${settings.formReminderTiming}`,
            relatedEntityType: 'form_assignment',
            relatedEntityId: created.id,
            scheduledFor: scheduledFor!,
          }, tx);
        }
      }
      return created;
    });
    return { ...assignment, completionPath: `/forms/complete/${token}` };
  }

  private assignmentScope(actor: Actor) { return actor.role === 'owner' ? undefined : eq(appointments.userId,actor.userId); }
  async listAssignments(actor: Actor, query: { status?: string; clientId?: string; appointmentId?: string; formId?: string; limit: number }) { return this.db.select({ id: formAssignments.id, formId: formAssignments.formId, formVersionId: formAssignments.formVersionId, clientId: formAssignments.clientId, appointmentId: formAssignments.appointmentId, status: formAssignments.status, expiresAt: formAssignments.expiresAt, createdAt: formAssignments.createdAt, openedAt: formAssignments.openedAt, submittedAt: formAssignments.submittedAt, formTitle: formVersions.titleSnapshot, clientName: clients.name }).from(formAssignments).innerJoin(formVersions,and(eq(formVersions.id,formAssignments.formVersionId),eq(formVersions.tenantId,actor.tenantId))).innerJoin(clients,and(eq(clients.id,formAssignments.clientId),eq(clients.tenantId,actor.tenantId))).leftJoin(appointments,and(eq(appointments.id,formAssignments.appointmentId),eq(appointments.tenantId,actor.tenantId))).where(and(eq(formAssignments.tenantId,actor.tenantId),query.status?eq(formAssignments.status,query.status):undefined,query.clientId?eq(formAssignments.clientId,query.clientId):undefined,query.appointmentId?eq(formAssignments.appointmentId,query.appointmentId):undefined,query.formId?eq(formAssignments.formId,query.formId):undefined,this.assignmentScope(actor))).orderBy(desc(formAssignments.createdAt)).limit(query.limit); }
  async getAssignment(actor: Actor,id:string){ const rows=await this.listAssignments(actor,{limit:100}); const row=rows.find((x)=>x.id===id); if(!row)throw err(404,'FORM_ASSIGNMENT_NOT_FOUND','Form assignment not found.');return row; }
  async cancelAssignment(actor:Actor,id:string){ await this.getAssignment(actor,id); const [row]=await this.db.update(formAssignments).set({status:'CANCELLED',cancelledAt:new Date(),updatedAt:new Date()}).where(and(eq(formAssignments.id,id),eq(formAssignments.tenantId,actor.tenantId),inArray(formAssignments.status,['PENDING','OPENED']))).returning({id:formAssignments.id});if(!row)throw err(409,'FORM_ALREADY_SUBMITTED','The assignment can no longer be cancelled.');await this.db.update(smsOutbox).set({status:'CANCELLED'}).where(and(eq(smsOutbox.formAssignmentId,id),inArray(smsOutbox.status,['PENDING','PROCESSING'])));await this.db.update(emailOutbox).set({status:'CANCELLED'}).where(and(eq(emailOutbox.relatedEntityType,'form_assignment'),eq(emailOutbox.relatedEntityId,id),inArray(emailOutbox.status,['PENDING','DELAYED','PROCESSING']))); }
  async regenerate(actor:Actor,id:string){await this.getAssignment(actor,id);const token=newToken();const [row]=await this.db.update(formAssignments).set({publicTokenHash:hashFormToken(token),status:'PENDING',openedAt:null,updatedAt:new Date()}).where(and(eq(formAssignments.id,id),eq(formAssignments.tenantId,actor.tenantId),inArray(formAssignments.status,['PENDING','OPENED']),gt(formAssignments.expiresAt,new Date()))).returning();if(!row)throw err(409,'FORM_ALREADY_SUBMITTED','The assignment link cannot be regenerated.');return{...row,completionPath:`/forms/complete/${token}`};}

  async getPublic(token:string){const hash=hashFormToken(token);return this.db.transaction(async(tx)=>{const [row]=await tx.select({id:formAssignments.id,status:formAssignments.status,expiresAt:formAssignments.expiresAt,title:formVersions.titleSnapshot,description:formVersions.descriptionSnapshot,schema:formVersions.schemaJson,acknowledgementText:formVersions.acknowledgementText,salonName:tenants.name,primaryColor:tenants.primaryColor,secondaryColor:tenants.secondaryColor,accentColor:tenants.accentColor}).from(formAssignments).innerJoin(formVersions,and(eq(formVersions.id,formAssignments.formVersionId),eq(formVersions.tenantId,formAssignments.tenantId))).innerJoin(tenants,eq(tenants.id,formAssignments.tenantId)).where(eq(formAssignments.publicTokenHash,hash)).limit(1);this.assertActive(row);if(row!.status==='PENDING')await tx.update(formAssignments).set({status:'OPENED',openedAt:new Date(),updatedAt:new Date()}).where(eq(formAssignments.id,row!.id));return{salon:{name:row!.salonName,primaryColor:row!.primaryColor,secondaryColor:row!.secondaryColor,accentColor:row!.accentColor},form:{title:row!.title,description:row!.description,schema:FormSchemaJsonSchema.parse(row!.schema),acknowledgementText:row!.acknowledgementText},expiresAt:row!.expiresAt};});}
  async submitPublic(token:string,input:PublicFormSubmission){const hash=hashFormToken(token);return this.db.transaction(async(tx)=>{const [row]=await tx.select().from(formAssignments).where(eq(formAssignments.publicTokenHash,hash)).for('update').limit(1);return this.completeLegacySubmission(tx,row,input,'PUBLIC_LINK');});}
  async submitCustomerPortal(customerAccountId:string,assignmentReference:string,input:PublicFormSubmission){return this.db.transaction(async(tx)=>{const [row]=await tx.select({id:formAssignments.id,status:formAssignments.status,expiresAt:formAssignments.expiresAt,formVersionId:formAssignments.formVersionId,tenantId:formAssignments.tenantId,clientId:formAssignments.clientId,formId:formAssignments.formId,appointmentId:formAssignments.appointmentId}).from(formAssignments).innerJoin(customerClientLinks,and(eq(customerClientLinks.customerAccountId,customerAccountId),eq(customerClientLinks.status,'ACTIVE'),eq(customerClientLinks.tenantId,formAssignments.tenantId),eq(customerClientLinks.clientId,formAssignments.clientId))).where(eq(formAssignments.publicReference,assignmentReference)).for('update').limit(1);return this.completeLegacySubmission(tx,row,input,'CUSTOMER_PORTAL');});}
  private async completeLegacySubmission(tx:any,row:any,input:PublicFormSubmission,submittedFrom:'PUBLIC_LINK'|'CUSTOMER_PORTAL'){
    if(row?.status==='SUBMITTED'){const existing=await tx.execute(sql`select id,submitted_at "submittedAt" from client_form_submissions where assignment_id=${row.id}::uuid and idempotency_key=${input.idempotencyKey}::uuid limit 1`);if(existing.rows[0])return existing.rows[0];throw err(409,'FORM_ALREADY_SUBMITTED','This form has already been submitted.');}
    this.assertActive(row);
    const versionResult=await tx.execute(sql`select schema_json,acknowledgement_text from form_versions where id=${row.formVersionId}::uuid and tenant_id=${row.tenantId}::uuid limit 1`);
    const version=versionResult.rows[0] as any;if(!version)throw err(404,'FORM_TOKEN_INVALID','This form link is invalid.');
    validateSubmission(version.schema_json,input);
    const createdResult=await tx.execute(sql`insert into client_form_submissions(tenant_id,client_id,form_id,assignment_id,form_version_id,appointment_id,response_json,acknowledgement_name,acknowledgement_accepted,acknowledgement_text,submitted_from,idempotency_key) values(${row.tenantId}::uuid,${row.clientId}::uuid,${row.formId}::uuid,${row.id}::uuid,${row.formVersionId}::uuid,${row.appointmentId||null}::uuid,${JSON.stringify(input.answers)}::jsonb,${input.acknowledgement.name},true,${version.acknowledgement_text},${submittedFrom},${input.idempotencyKey}::uuid) returning id,submitted_at "submittedAt"`);
    const created=createdResult.rows[0] as any;
    await tx.execute(sql`update form_assignments set status='SUBMITTED',submitted_at=${created.submittedAt},updated_at=now() where id=${row.id}::uuid and tenant_id=${row.tenantId}::uuid`);
    return created;
  }
  async saveDraft(token:string,input:{answers:Record<string,unknown>;currentPage:number;revision:number;language:string;timezone?:string}){const assignmentHash=hashFormToken(token),resumeToken=newToken();const result=await this.db.transaction(async tx=>{const assignment=(await tx.execute(sql`select id,tenant_id,form_version_id,expires_at,status from form_assignments where public_token_hash=${assignmentHash} for update`)).rows[0] as any;this.assertActive(assignment&&{status:assignment.status,expiresAt:new Date(assignment.expires_at)});const version=(await tx.execute(sql`select schema_json from form_versions where id=${assignment.form_version_id} and tenant_id=${assignment.tenant_id}`)).rows[0] as any;if(!version)throw err(404,'FORM_TOKEN_INVALID','This form link is invalid.');const schema=FormSchemaJsonSchema.parse(version.schema_json);const known=new Set(schema.fields.map(f=>f.key||f.id));if(Object.keys(input.answers).some(k=>!known.has(k)))throw err(400,'FORM_UNKNOWN_ANSWER','Draft contains an unknown answer.');const completion=Math.round(100*Object.keys(input.answers).filter(k=>input.answers[k]!==''&&input.answers[k]!=null).length/Math.max(1,schema.fields.filter(f=>!['INFORMATION','HEADING','DIVIDER'].includes(f.type)).length));const existing=(await tx.execute(sql`select id,revision from form_submission_drafts where assignment_id=${assignment.id} and revoked_at is null`)).rows[0] as any;if(existing&&existing.revision!==input.revision)throw err(409,'FORM_DRAFT_CONFLICT','A newer draft exists. Reload before saving.');const saved=existing?(await tx.execute(sql`update form_submission_drafts set answers_json=${input.answers},current_page=${input.currentPage},completion_percentage=${completion},revision=revision+1,language=${input.language},timezone=${input.timezone??null},last_saved_at=now() where id=${existing.id}::uuid returning id,revision,last_saved_at,completion_percentage`)).rows[0]:(await tx.execute(sql`insert into form_submission_drafts(tenant_id,assignment_id,form_version_id,resume_token_hash,answers_json,current_page,completion_percentage,language,timezone,expires_at) values(${assignment.tenant_id}::uuid,${assignment.id}::uuid,${assignment.form_version_id}::uuid,${hashFormToken(resumeToken)},${input.answers},${input.currentPage},${completion},${input.language},${input.timezone??null},${assignment.expires_at}) returning id,revision,last_saved_at,completion_percentage`)).rows[0];return{...saved,resumeToken:existing?undefined:resumeToken};});return result;}
  async resumeDraft(resumeToken:string){const row=(await this.db.execute(sql`select d.answers_json,d.current_page,d.revision,d.language,d.timezone,d.last_saved_at,d.completion_percentage from form_submission_drafts d join form_assignments a on a.id=d.assignment_id where d.resume_token_hash=${hashFormToken(resumeToken)} and d.revoked_at is null and d.expires_at>now() and a.status in('PENDING','OPENED') limit 1`)).rows[0];if(!row)throw err(404,'FORM_RESUME_INVALID','This resume link is invalid or expired.');return row;}
  async reviewSubmission(actor:Actor,id:string,input:{status:string;notes?:string;fieldKeys:string[]}){const review={status:input.status,notes:input.notes||null,fieldKeys:input.fieldKeys,reviewedAt:new Date().toISOString(),reviewedByUserId:actor.userId};const row=(await this.db.execute(sql`update client_form_submissions set response_json=jsonb_set(response_json,'{_review}',${JSON.stringify(review)}::jsonb,true) where id=${id}::uuid and tenant_id=${actor.tenantId}::uuid returning id,response_json->'_review' review`)).rows[0];if(!row)throw err(404,'FORM_SUBMISSION_NOT_FOUND','Form submission not found.');return row;}
  async recordAnalytics(_token:string,_input:any){return;}
  private async completeSubmission(tx:any,row:any,input:PublicFormSubmission,submittedFrom:'PUBLIC_LINK'|'CUSTOMER_PORTAL'){if(row?.status==='SUBMITTED'){const [existing]=await tx.select({id:clientFormSubmissions.id,submittedAt:clientFormSubmissions.submittedAt,idempotencyKey:clientFormSubmissions.idempotencyKey}).from(clientFormSubmissions).where(and(eq(clientFormSubmissions.assignmentId,row.id),eq(clientFormSubmissions.idempotencyKey,input.idempotencyKey))).limit(1);if(existing)return existing;throw err(409,'FORM_ALREADY_SUBMITTED','This form has already been submitted.');}this.assertActive(row);const [version]=await tx.select().from(formVersions).where(and(eq(formVersions.id,row!.formVersionId),eq(formVersions.tenantId,row!.tenantId))).limit(1);if(!version)throw err(404,'FORM_TOKEN_INVALID','This form link is invalid.');const schema=validateSubmission(version.schemaJson,input);const [created]=await tx.insert(clientFormSubmissions).values({tenantId:row!.tenantId,clientId:row!.clientId,formId:row!.formId,assignmentId:row!.id,formVersionId:row!.formVersionId,appointmentId:row!.appointmentId,responseJson:input.answers,acknowledgementName:input.acknowledgement.name,acknowledgementAccepted:true,acknowledgementText:version.acknowledgementText,submittedFrom,idempotencyKey:input.idempotencyKey,language:input.language,timezone:input.timezone,trackingParameters:input.trackingParameters}).returning({id:clientFormSubmissions.id,submittedAt:clientFormSubmissions.submittedAt});for(const field of schema.fields){const fieldKey=field.key||field.id;if(!(fieldKey in input.answers))continue;const raw=input.answers[fieldKey];await tx.execute(sql`insert into form_submission_answers(submission_id,tenant_id,field_id,field_key,answer_type,value_json,display_value,sensitive_classification) values(${created.id}::uuid,${row!.tenantId}::uuid,${field.id}::uuid,${fieldKey},${field.type},${raw},${typeof raw==='string'?raw.slice(0,2000):null},${field.sensitiveClassification})`);}await tx.execute(sql`update form_submission_drafts set revoked_at=now() where assignment_id=${row!.id}::uuid`);await tx.update(formAssignments).set({status:'SUBMITTED',submittedAt:created.submittedAt,updatedAt:new Date()}).where(and(eq(formAssignments.id,row!.id),eq(formAssignments.tenantId,row!.tenantId)));await tx.update(smsOutbox).set({status:'CANCELLED'}).where(and(eq(smsOutbox.formAssignmentId,row!.id),eq(smsOutbox.templateKey,'form-reminder'),inArray(smsOutbox.status,['PENDING','PROCESSING'])));await tx.update(emailOutbox).set({status:'CANCELLED'}).where(and(eq(emailOutbox.relatedEntityType,'form_assignment'),eq(emailOutbox.relatedEntityId,row!.id),eq(emailOutbox.templateKey,'form-reminder'),inArray(emailOutbox.status,['PENDING','DELAYED','PROCESSING'])));await this.businessEvents.emit({id:stableEventId('FORM_SUBMITTED',row!.id,created.id),tenantId:row!.tenantId,type:'FORM_SUBMITTED',occurredAt:created.submittedAt.toISOString(),sourceType:'form_assignment',sourceId:row!.id,payload:{assignmentId:row!.id,formId:row!.formId,appointmentId:row!.appointmentId,status:'SUBMITTED'}},tx);const {OperationsIssueReporter}=await import('../operations/operations.issue-service.js');await new OperationsIssueReporter().resolve(row!.tenantId,`FORM_OVERDUE:${row!.id}`,tx);return created;}

  async listSubmissions(actor:Actor,query:{clientId?:string;appointmentId?:string;formId?:string;status?:string;from?:string;to?:string;limit:number}){const result=await this.db.execute(sql`select s.id,v.title_snapshot "formTitle",v.version_number "versionNumber",c.name "clientName",s.appointment_id "appointmentId",s.submitted_at "submittedAt",'SUBMITTED' status,'[]'::jsonb "reviewFlags" from client_form_submissions s join form_versions v on v.id=s.form_version_id and v.tenant_id=s.tenant_id join clients c on c.id=s.client_id and c.tenant_id=s.tenant_id where s.tenant_id=${actor.tenantId}::uuid ${query.clientId?sql`and s.client_id=${query.clientId}::uuid`:sql``} ${query.appointmentId?sql`and s.appointment_id=${query.appointmentId}::uuid`:sql``} ${query.formId?sql`and s.form_id=${query.formId}::uuid`:sql``} order by s.submitted_at desc limit ${query.limit}`);return result.rows;}
  async getSubmission(actor:Actor,id:string){const [row]=await this.db.select({id:clientFormSubmissions.id,formTitle:formVersions.titleSnapshot,versionNumber:formVersions.versionNumber,schema:formVersions.schemaJson,answers:clientFormSubmissions.responseJson,clientName:clients.name,appointmentId:clientFormSubmissions.appointmentId,acknowledgementName:clientFormSubmissions.acknowledgementName,acknowledgementAccepted:clientFormSubmissions.acknowledgementAccepted,acknowledgementText:clientFormSubmissions.acknowledgementText,submittedAt:clientFormSubmissions.submittedAt}).from(clientFormSubmissions).innerJoin(formVersions,and(eq(formVersions.id,clientFormSubmissions.formVersionId),eq(formVersions.tenantId,actor.tenantId))).innerJoin(clients,and(eq(clients.id,clientFormSubmissions.clientId),eq(clients.tenantId,actor.tenantId))).leftJoin(appointments,and(eq(appointments.id,clientFormSubmissions.appointmentId),eq(appointments.tenantId,actor.tenantId))).where(and(eq(clientFormSubmissions.id,id),eq(clientFormSubmissions.tenantId,actor.tenantId),this.assignmentScope(actor))).limit(1);if(!row)throw err(404,'FORM_ASSIGNMENT_NOT_FOUND','Form submission not found.');const schema=FormSchemaJsonSchema.parse(row.schema);return{...row,schema:undefined,answers:undefined,renderedAnswers:renderAnswers(schema,row.answers as Record<string,unknown>)};}
  private owner(actor:Actor){if(actor.role!=='owner')throw err(403,'FORM_ACCESS_DENIED','Owner access is required.');}
  private assertActive(row:{status:string;expiresAt:Date}|undefined){if(!row)throw err(404,'FORM_TOKEN_INVALID','This form link is invalid.');if(row.status==='CANCELLED')throw err(410,'FORM_ASSIGNMENT_CANCELLED','This form link was cancelled.');if(row.expiresAt<=new Date()||row.status==='EXPIRED')throw err(410,'FORM_ASSIGNMENT_EXPIRED','This form link has expired.');if(row.status==='SUBMITTED')throw err(409,'FORM_ALREADY_SUBMITTED','This form has already been submitted.');if(!['PENDING','OPENED'].includes(row.status))throw err(404,'FORM_TOKEN_INVALID','This form link is invalid.');}
}
