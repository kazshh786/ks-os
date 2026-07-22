import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, inArray, max, sql } from 'drizzle-orm';
import { appointments, clientFormSubmissions, clients, customerClientLinks, emailOutbox, formAssignments, forms, formVersions, getDatabase, smsOutbox, tenants } from '@ks-os/database';
import { FormDraftInputSchema, FormSchemaJsonSchema, type CreateFormAssignmentInput, type PublicFormSubmission } from '@ks-os/contracts';
import { renderAnswers, validateSubmission } from './forms.validation.js';
import { SmsService } from '../sms/sms.service.js';
import { EmailService } from '../email/email.service.js';
import { env } from '../../config/env.js';
import { BusinessEventsService, stableEventId } from '../automations/business-events.service.js';

type Actor = { tenantId: string; userId: string; role: 'owner' | 'staff' };
const err = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
export const hashFormToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

export class FormsService {
  private db = getDatabase();
  private businessEvents = new BusinessEventsService();
  private email = new EmailService();

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
    const [form] = await this.db.select().from(forms).where(and(eq(forms.id, formId), eq(forms.tenantId, actor.tenantId), actor.role === 'staff' ? eq(forms.status, 'PUBLISHED') : undefined)).limit(1);
    if (!form) throw err(404, 'FORM_NOT_FOUND', 'Form not found.');
    return form;
  }

  async create(actor: Actor, value: unknown) {
    this.owner(actor); const input = FormDraftInputSchema.parse(value);
    const [created] = await this.db.insert(forms).values({ tenantId: actor.tenantId, title: input.title, description: input.description, fieldsJson: input.schema, acknowledgementText: input.acknowledgementText, status: 'DRAFT', createdByUserId: actor.userId }).returning();
    return created;
  }

  async update(actor: Actor, formId: string, value: unknown) {
    this.owner(actor); const input = FormDraftInputSchema.parse(value);
    const [updated] = await this.db.update(forms).set({ title: input.title, description: input.description, fieldsJson: input.schema, acknowledgementText: input.acknowledgementText, status: 'DRAFT', updatedAt: new Date() })
      .where(and(eq(forms.id, formId), eq(forms.tenantId, actor.tenantId), inArray(forms.status, ['DRAFT','PUBLISHED']))).returning();
    if (!updated) throw err(404, 'FORM_NOT_FOUND', 'Form not found.');
    return updated;
  }

  async publish(actor: Actor, formId: string) {
    this.owner(actor);
    return this.db.transaction(async (tx) => {
      const [form] = await tx.select().from(forms).where(and(eq(forms.id, formId), eq(forms.tenantId, actor.tenantId), eq(forms.status, 'DRAFT'))).for('update').limit(1);
      if (!form) throw err(409, 'FORM_VERSION_IMMUTABLE', 'Only a draft can be published.');
      const schema = FormSchemaJsonSchema.parse(form.fieldsJson);
      if (!form.acknowledgementText.trim()) throw err(400, 'FORM_INVALID_SCHEMA', 'Acknowledgement text is required before publication.');
      const [latest] = await tx.select({ value: max(formVersions.versionNumber) }).from(formVersions).where(and(eq(formVersions.formId, formId), eq(formVersions.tenantId, actor.tenantId)));
      const [version] = await tx.insert(formVersions).values({ tenantId: actor.tenantId, formId, versionNumber: (latest?.value ?? 0) + 1, titleSnapshot: form.title, descriptionSnapshot: form.description, schemaJson: schema, acknowledgementText: form.acknowledgementText, createdByUserId: actor.userId }).returning();
      await tx.update(forms).set({ status: 'PUBLISHED', updatedAt: new Date() }).where(and(eq(forms.id, formId), eq(forms.tenantId, actor.tenantId)));
      return version;
    });
  }

  async archive(actor: Actor, formId: string) { this.owner(actor); const [row] = await this.db.update(forms).set({ status: 'ARCHIVED', archivedAt: new Date(), updatedAt: new Date() }).where(and(eq(forms.id, formId), eq(forms.tenantId, actor.tenantId))).returning({ id: forms.id }); if (!row) throw err(404,'FORM_NOT_FOUND','Form not found.'); }
  async listVersions(actor: Actor, formId: string) { await this.getForm(actor, formId); return this.db.select().from(formVersions).where(and(eq(formVersions.formId, formId), eq(formVersions.tenantId, actor.tenantId))).orderBy(desc(formVersions.versionNumber)); }
  async getVersion(actor: Actor, formId: string, versionId: string) { const [row] = await this.db.select().from(formVersions).where(and(eq(formVersions.id,versionId),eq(formVersions.formId,formId),eq(formVersions.tenantId,actor.tenantId))).limit(1); if (!row) throw err(404,'FORM_VERSION_NOT_FOUND','Form version not found.'); return row; }

  async createAssignment(actor: Actor, input: CreateFormAssignmentInput, expiryDays: number) {
    if (actor.role === 'staff' && !input.appointmentId) throw err(403,'FORM_ACCESS_DENIED','Staff assignments require one of your appointments.');
    const token = newToken();
    const assignment = await this.db.transaction(async (tx) => {
      const [client] = await tx.select().from(clients).where(and(eq(clients.id,input.clientId),eq(clients.tenantId,actor.tenantId))).limit(1);
      if (!client) throw err(404,'FORM_ASSIGNMENT_NOT_FOUND','Assignment target not found.');
      if (input.appointmentId) { const [appt] = await tx.select({ id: appointments.id, userId: appointments.userId }).from(appointments).where(and(eq(appointments.id,input.appointmentId),eq(appointments.clientId,input.clientId),eq(appointments.tenantId,actor.tenantId))).limit(1); if (!appt) throw err(404,'FORM_ASSIGNMENT_NOT_FOUND','Assignment target not found.'); if (actor.role === 'staff' && appt.userId !== actor.userId) throw err(403,'FORM_ACCESS_DENIED','You cannot assign forms for this appointment.'); }
      const versionFilter = input.formVersionId ? eq(formVersions.id,input.formVersionId) : undefined;
      const [version] = await tx.select().from(formVersions).innerJoin(forms,and(eq(forms.id,formVersions.formId),eq(forms.tenantId,formVersions.tenantId))).where(and(eq(formVersions.formId,input.formId),eq(formVersions.tenantId,actor.tenantId),eq(forms.status,'PUBLISHED'),versionFilter)).orderBy(desc(formVersions.versionNumber)).limit(1);
      if (!version) throw err(409,'FORM_NOT_PUBLISHED','A published form version is required.');
      const expiresAt = new Date(Date.now() + expiryDays * 86400000);
      const [created] = await tx.insert(formAssignments).values({ tenantId: actor.tenantId, formId: input.formId, formVersionId: version.form_versions.id, clientId: input.clientId, appointmentId: input.appointmentId, publicTokenHash: hashFormToken(token), expiresAt, assignedByUserId: actor.userId }).returning();
      await this.businessEvents.emit({id:stableEventId('FORM_ASSIGNED',created.id,'created'),tenantId:actor.tenantId,type:'FORM_ASSIGNED',occurredAt:new Date().toISOString(),sourceType:'form_assignment',sourceId:created.id,payload:{assignmentId:created.id,formId:created.formId,appointmentId:created.appointmentId,status:'PENDING'}},tx);
      const [tenant]=await tx.select().from(tenants).where(eq(tenants.id,actor.tenantId)).limit(1);
      const secureUrl = env.PUBLIC_APP_ORIGIN ? `${env.PUBLIC_APP_ORIGIN}/forms/complete/${token}` : undefined;
      if(input.deliveryMethod==='SMS'&&client.phone){if(tenant?.smsEnabled&&tenant.smsFormDeliveryEnabled&&secureUrl)await new SmsService().enqueue({tenantId:actor.tenantId,clientId:client.id,appointmentId:input.appointmentId,formAssignmentId:created.id,recipientPhone:client.phone,templateKey:'form-assigned',templateData:{formTitle:version.form_versions.titleSnapshot,secureUrl},idempotencyKey:`sms-form-${created.id}`,validUntil:expiresAt},tx);}
      if(client.email&&tenant?.formDeliveryEnabled&&secureUrl) {
        await this.email.enqueueEmail({tenantId:actor.tenantId,recipientEmail:client.email,recipientName:client.name,replyToEmail:tenant.replyToEmail||undefined,templateKey:'form-assigned',templateDataJson:{tenantName:tenant.senderDisplayName||tenant.name,tenantPrimaryColor:tenant.primaryColor,customerName:client.name,formName:version.form_versions.titleSnapshot,formLink:secureUrl},idempotencyKey:`form-assigned-email:${created.id}`,relatedEntityType:'form_assignment',relatedEntityId:created.id},tx);
        if(tenant.formRemindersEnabled&&input.appointmentId&&tenant.formReminderTiming!=='none'){
          const [appt]=await tx.select({startTime:appointments.startTime}).from(appointments).where(and(eq(appointments.id,input.appointmentId),eq(appointments.tenantId,actor.tenantId))).limit(1);
          if(appt?.startTime){const hours=tenant.formReminderTiming.startsWith('48')?48:24;const scheduledFor=new Date(appt.startTime.getTime()-hours*3600000);if(scheduledFor>new Date()&&scheduledFor<expiresAt)await this.email.enqueueEmail({tenantId:actor.tenantId,recipientEmail:client.email,recipientName:client.name,replyToEmail:tenant.replyToEmail||undefined,templateKey:'form-reminder',templateDataJson:{tenantName:tenant.senderDisplayName||tenant.name,tenantPrimaryColor:tenant.primaryColor,customerName:client.name,formName:version.form_versions.titleSnapshot,formLink:secureUrl},idempotencyKey:`form-reminder-email:${created.id}:${hours}`,relatedEntityType:'form_assignment',relatedEntityId:created.id,scheduledFor},tx);}
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
  async submitPublic(token:string,input:PublicFormSubmission){const hash=hashFormToken(token);return this.db.transaction(async(tx)=>{const [row]=await tx.select().from(formAssignments).where(eq(formAssignments.publicTokenHash,hash)).for('update').limit(1);return this.completeSubmission(tx,row,input,'PUBLIC_LINK');});}
  async submitCustomerPortal(customerAccountId:string,assignmentReference:string,input:PublicFormSubmission){return this.db.transaction(async(tx)=>{const [row]=await tx.select({id:formAssignments.id,status:formAssignments.status,expiresAt:formAssignments.expiresAt,formVersionId:formAssignments.formVersionId,tenantId:formAssignments.tenantId,clientId:formAssignments.clientId,formId:formAssignments.formId,appointmentId:formAssignments.appointmentId}).from(formAssignments).innerJoin(customerClientLinks,and(eq(customerClientLinks.customerAccountId,customerAccountId),eq(customerClientLinks.status,'ACTIVE'),eq(customerClientLinks.tenantId,formAssignments.tenantId),eq(customerClientLinks.clientId,formAssignments.clientId))).where(eq(formAssignments.publicReference,assignmentReference)).for('update').limit(1);return this.completeSubmission(tx,row,input,'CUSTOMER_PORTAL');});}
  private async completeSubmission(tx:any,row:any,input:PublicFormSubmission,submittedFrom:'PUBLIC_LINK'|'CUSTOMER_PORTAL'){if(row?.status==='SUBMITTED'){const [existing]=await tx.select({id:clientFormSubmissions.id,submittedAt:clientFormSubmissions.submittedAt,idempotencyKey:clientFormSubmissions.idempotencyKey}).from(clientFormSubmissions).where(and(eq(clientFormSubmissions.assignmentId,row.id),eq(clientFormSubmissions.idempotencyKey,input.idempotencyKey))).limit(1);if(existing)return existing;throw err(409,'FORM_ALREADY_SUBMITTED','This form has already been submitted.');}this.assertActive(row);const [version]=await tx.select().from(formVersions).where(and(eq(formVersions.id,row!.formVersionId),eq(formVersions.tenantId,row!.tenantId))).limit(1);if(!version)throw err(404,'FORM_TOKEN_INVALID','This form link is invalid.');validateSubmission(version.schemaJson,input);const [created]=await tx.insert(clientFormSubmissions).values({tenantId:row!.tenantId,clientId:row!.clientId,formId:row!.formId,assignmentId:row!.id,formVersionId:row!.formVersionId,appointmentId:row!.appointmentId,responseJson:input.answers,acknowledgementName:input.acknowledgement.name,acknowledgementAccepted:true,acknowledgementText:version.acknowledgementText,submittedFrom,idempotencyKey:input.idempotencyKey}).returning({id:clientFormSubmissions.id,submittedAt:clientFormSubmissions.submittedAt});await tx.update(formAssignments).set({status:'SUBMITTED',submittedAt:created.submittedAt,updatedAt:new Date()}).where(and(eq(formAssignments.id,row!.id),eq(formAssignments.tenantId,row!.tenantId)));await tx.update(smsOutbox).set({status:'CANCELLED'}).where(and(eq(smsOutbox.formAssignmentId,row!.id),eq(smsOutbox.templateKey,'form-reminder'),inArray(smsOutbox.status,['PENDING','PROCESSING'])));await tx.update(emailOutbox).set({status:'CANCELLED'}).where(and(eq(emailOutbox.relatedEntityType,'form_assignment'),eq(emailOutbox.relatedEntityId,row!.id),eq(emailOutbox.templateKey,'form-reminder'),inArray(emailOutbox.status,['PENDING','DELAYED','PROCESSING'])));await this.businessEvents.emit({id:stableEventId('FORM_SUBMITTED',row!.id,created.id),tenantId:row!.tenantId,type:'FORM_SUBMITTED',occurredAt:created.submittedAt.toISOString(),sourceType:'form_assignment',sourceId:row!.id,payload:{assignmentId:row!.id,formId:row!.formId,appointmentId:row!.appointmentId,status:'SUBMITTED'}},tx);const {OperationsIssueReporter}=await import('../operations/operations.issue-service.js');await new OperationsIssueReporter().resolve(row!.tenantId,`FORM_OVERDUE:${row!.id}`,tx);return created;}

  async listSubmissions(actor:Actor,query:{clientId?:string;appointmentId?:string;formId?:string;from?:string;to?:string;limit:number}){return this.db.select({id:clientFormSubmissions.id,formTitle:formVersions.titleSnapshot,versionNumber:formVersions.versionNumber,clientName:clients.name,appointmentId:clientFormSubmissions.appointmentId,submittedAt:clientFormSubmissions.submittedAt}).from(clientFormSubmissions).innerJoin(formVersions,and(eq(formVersions.id,clientFormSubmissions.formVersionId),eq(formVersions.tenantId,actor.tenantId))).innerJoin(clients,and(eq(clients.id,clientFormSubmissions.clientId),eq(clients.tenantId,actor.tenantId))).leftJoin(appointments,and(eq(appointments.id,clientFormSubmissions.appointmentId),eq(appointments.tenantId,actor.tenantId))).where(and(eq(clientFormSubmissions.tenantId,actor.tenantId),query.clientId?eq(clientFormSubmissions.clientId,query.clientId):undefined,query.appointmentId?eq(clientFormSubmissions.appointmentId,query.appointmentId):undefined,query.formId?eq(clientFormSubmissions.formId,query.formId):undefined,query.from?gt(clientFormSubmissions.submittedAt,new Date(query.from)):undefined,query.to?sql`${clientFormSubmissions.submittedAt} <= ${new Date(query.to)}`:undefined,this.assignmentScope(actor))).orderBy(desc(clientFormSubmissions.submittedAt)).limit(query.limit);}
  async getSubmission(actor:Actor,id:string){const [row]=await this.db.select({id:clientFormSubmissions.id,formTitle:formVersions.titleSnapshot,versionNumber:formVersions.versionNumber,schema:formVersions.schemaJson,answers:clientFormSubmissions.responseJson,clientName:clients.name,appointmentId:clientFormSubmissions.appointmentId,acknowledgementName:clientFormSubmissions.acknowledgementName,acknowledgementAccepted:clientFormSubmissions.acknowledgementAccepted,acknowledgementText:clientFormSubmissions.acknowledgementText,submittedAt:clientFormSubmissions.submittedAt}).from(clientFormSubmissions).innerJoin(formVersions,and(eq(formVersions.id,clientFormSubmissions.formVersionId),eq(formVersions.tenantId,actor.tenantId))).innerJoin(clients,and(eq(clients.id,clientFormSubmissions.clientId),eq(clients.tenantId,actor.tenantId))).leftJoin(appointments,and(eq(appointments.id,clientFormSubmissions.appointmentId),eq(appointments.tenantId,actor.tenantId))).where(and(eq(clientFormSubmissions.id,id),eq(clientFormSubmissions.tenantId,actor.tenantId),this.assignmentScope(actor))).limit(1);if(!row)throw err(404,'FORM_ASSIGNMENT_NOT_FOUND','Form submission not found.');const schema=FormSchemaJsonSchema.parse(row.schema);return{...row,schema:undefined,answers:undefined,renderedAnswers:renderAnswers(schema,row.answers as Record<string,unknown>)};}
  private owner(actor:Actor){if(actor.role!=='owner')throw err(403,'FORM_ACCESS_DENIED','Owner access is required.');}
  private assertActive(row:{status:string;expiresAt:Date}|undefined){if(!row)throw err(404,'FORM_TOKEN_INVALID','This form link is invalid.');if(row.status==='CANCELLED')throw err(410,'FORM_ASSIGNMENT_CANCELLED','This form link was cancelled.');if(row.expiresAt<=new Date()||row.status==='EXPIRED')throw err(410,'FORM_ASSIGNMENT_EXPIRED','This form link has expired.');if(row.status==='SUBMITTED')throw err(409,'FORM_ALREADY_SUBMITTED','This form has already been submitted.');if(!['PENDING','OPENED'].includes(row.status))throw err(404,'FORM_TOKEN_INVALID','This form link is invalid.');}
}
