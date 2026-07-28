import { sql } from 'drizzle-orm';
import { getDatabase } from '@ks-os/database';
import { FormSchemaJsonSchema, type PublicFormSubmission } from '@ks-os/contracts';
import { validateSubmission } from './forms.validation.js';

type Database = ReturnType<typeof getDatabase>;
type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

const safeSlug = (value: string) => value.trim().toLowerCase();

export class PublicWorkspaceFormsService {
  private readonly db = getDatabase();

  private async resolvePublished(workspaceSlugValue: string, formSlugValue: string, executor: Executor = this.db) {
    const workspaceSlug = safeSlug(workspaceSlugValue);
    const formSlug = safeSlug(formSlugValue);
    const result = await executor.execute(sql`
      SELECT
        tenant.id AS tenant_id,
        tenant.name AS tenant_name,
        tenant.primary_color,
        tenant.secondary_color,
        tenant.accent_color,
        form.id AS form_id,
        form.public_slug,
        version.id AS form_version_id,
        version.title_snapshot,
        version.description_snapshot,
        version.schema_json,
        version.acknowledgement_text
      FROM tenants tenant
      JOIN forms form
        ON form.tenant_id = tenant.id
       AND form.status = 'PUBLISHED'
       AND form.public_slug = ${formSlug}
      JOIN LATERAL (
        SELECT candidate.*
        FROM form_versions candidate
        WHERE candidate.tenant_id = form.tenant_id
          AND candidate.form_id = form.id
        ORDER BY
          CASE WHEN candidate.id = form.published_version_id THEN 0 ELSE 1 END,
          candidate.version_number DESC
        LIMIT 1
      ) version ON true
      WHERE tenant.subdomain = ${workspaceSlug}
        AND tenant.is_active = true
        AND tenant.lifecycle_status = 'ACTIVE'
      LIMIT 1
    `);
    const row = result.rows[0] as {
      tenant_id: string;
      tenant_name: string;
      primary_color: string;
      secondary_color: string;
      accent_color: string;
      form_id: string;
      public_slug: string;
      form_version_id: string;
      title_snapshot: string;
      description_snapshot: string;
      schema_json: unknown;
      acknowledgement_text: string;
    } | undefined;
    if (!row) throw fail(404, 'PUBLIC_FORM_NOT_FOUND', 'This form is not available.');
    return row;
  }

  async getManageLink(tenantId: string, formId: string) {
    const result = await this.db.execute(sql`
      SELECT
        form.id AS form_id,
        form.public_slug,
        form.status,
        tenant.subdomain AS workspace_slug
      FROM forms form
      JOIN tenants tenant ON tenant.id = form.tenant_id
      WHERE form.id = ${formId}::uuid
        AND form.tenant_id = ${tenantId}::uuid
      LIMIT 1
    `);
    const row = result.rows[0] as {
      form_id: string;
      public_slug: string | null;
      status: string;
      workspace_slug: string;
    } | undefined;
    if (!row) throw fail(404, 'FORM_NOT_FOUND', 'Form not found.');
    const publicSlug = row.public_slug || 'form';
    return {
      formId: row.form_id,
      publicSlug,
      workspaceSlug: row.workspace_slug,
      path: `/form/${publicSlug}`,
      status: row.status,
    };
  }

  async getPublic(workspaceSlug: string, formSlug: string) {
    const row = await this.resolvePublished(workspaceSlug, formSlug);
    return {
      salon: {
        name: row.tenant_name,
        primaryColor: row.primary_color,
        secondaryColor: row.secondary_color,
        accentColor: row.accent_color,
      },
      form: {
        title: row.title_snapshot,
        description: row.description_snapshot,
        publicSlug: row.public_slug,
        schema: FormSchemaJsonSchema.parse(row.schema_json),
        acknowledgementText: row.acknowledgement_text,
      },
    };
  }

  async submit(workspaceSlug: string, formSlug: string, input: PublicFormSubmission) {
    return this.db.transaction(async tx => {
      const row = await this.resolvePublished(workspaceSlug, formSlug, tx);
      const schema = validateSubmission(row.schema_json, input);

      const existingResult = await tx.execute(sql`
        SELECT id, submitted_at AS "submittedAt"
        FROM client_form_submissions
        WHERE tenant_id = ${row.tenant_id}::uuid
          AND form_id = ${row.form_id}::uuid
          AND idempotency_key = ${input.idempotencyKey}::uuid
        LIMIT 1
      `);
      if (existingResult.rows[0]) return existingResult.rows[0];

      const answerForType = (type: string) => {
        const field = schema.fields.find(candidate => candidate.type === type);
        if (!field) return null;
        const answer = input.answers[field.key || field.id];
        return typeof answer === 'string' && answer.trim() ? answer.trim() : null;
      };
      const email = answerForType('EMAIL')?.toLowerCase() || null;
      const phone = answerForType('PHONE') || null;
      const customerName = input.acknowledgement.name.trim();

      const clientResult = await tx.execute(sql`
        SELECT id
        FROM clients
        WHERE tenant_id = ${row.tenant_id}::uuid
          AND (
            (${email}::text IS NOT NULL AND lower(email) = ${email})
            OR (${phone}::text IS NOT NULL AND phone = ${phone})
          )
        ORDER BY updated_at DESC
        LIMIT 1
      `);
      let clientId = (clientResult.rows[0] as { id: string } | undefined)?.id;
      if (!clientId) {
        const createdClient = await tx.execute(sql`
          INSERT INTO clients (tenant_id, name, email, phone)
          VALUES (${row.tenant_id}::uuid, ${customerName}, ${email}, ${phone})
          RETURNING id
        `);
        clientId = (createdClient.rows[0] as { id: string }).id;
      }

      const createdResult = await tx.execute(sql`
        INSERT INTO client_form_submissions (
          tenant_id,
          client_id,
          form_id,
          form_version_id,
          response_json,
          acknowledgement_name,
          acknowledgement_accepted,
          acknowledgement_text,
          submitted_from,
          idempotency_key,
          language,
          timezone,
          tracking_parameters
        ) VALUES (
          ${row.tenant_id}::uuid,
          ${clientId}::uuid,
          ${row.form_id}::uuid,
          ${row.form_version_id}::uuid,
          ${JSON.stringify(input.answers)}::jsonb,
          ${customerName},
          true,
          ${row.acknowledgement_text},
          'PUBLIC_FORM',
          ${input.idempotencyKey}::uuid,
          ${input.language},
          ${input.timezone || null},
          ${JSON.stringify(input.trackingParameters)}::jsonb
        )
        RETURNING id, submitted_at AS "submittedAt"
      `);
      return createdResult.rows[0];
    });
  }
}
