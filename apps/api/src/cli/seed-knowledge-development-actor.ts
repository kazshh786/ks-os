import { closeDatabase, agencyUsers, getDatabase } from '@ks-os/database';
import { and, eq, inArray } from 'drizzle-orm';
import {
  AgencyAuditService,
  type AgencyActor,
} from '../modules/agency/agency.service.js';

const DEVELOPMENT_EMAIL = 'knowledge.operator@ksos.local';

function assertDevelopmentDatabase() {
  const connectionString = process.env.DATABASE_URL;
  const environment = (process.env.APP_ENV ?? process.env.NODE_ENV ?? '')
    .toLowerCase();
  const allowedProjectRef = process.env.KNOWLEDGE_IMPORT_ALLOWED_PROJECT_REF;
  if (!connectionString || environment !== 'development') {
    throw new Error('The knowledge operator seed requires APP_ENV=development.');
  }
  const connection = new URL(connectionString);
  const databaseProjectRef = decodeURIComponent(connection.username)
    .match(/\.([a-z0-9]{20})$/i)?.[1]
    ?? connection.hostname.match(/^db\.([a-z0-9]{20})\.supabase\.co$/i)?.[1];
  if (
    process.env.KNOWLEDGE_IMPORT_ALLOW_REMOTE_DEVELOPMENT !== 'true'
    || !allowedProjectRef
    || databaseProjectRef !== allowedProjectRef
    || connection.searchParams.get('sslmode') !== 'require'
  ) {
    throw new Error('The designated development database was not positively identified.');
  }
}

async function main() {
  assertDevelopmentDatabase();
  const database = getDatabase();
  const [eligible] = await database.select({
    id: agencyUsers.id,
    publicReference: agencyUsers.publicReference,
    role: agencyUsers.role,
  }).from(agencyUsers).where(and(
    eq(agencyUsers.status, 'ACTIVE'),
    inArray(agencyUsers.role, ['PLATFORM_OWNER', 'AGENCY_ADMINISTRATOR']),
  )).limit(1);
  if (eligible) {
    process.stdout.write(`${JSON.stringify({
      mode: 'EXISTING_DEVELOPMENT_ACTOR',
      actorReference: eligible.publicReference,
      role: eligible.role,
    })}\n`);
    return;
  }

  const audit = new AgencyAuditService();
  const created = await database.transaction(async transaction => {
    const [actorRecord] = await transaction.insert(agencyUsers).values({
      emailNormalized: DEVELOPMENT_EMAIL,
      displayName: 'Knowledge Import Development Operator',
      role: 'PLATFORM_OWNER',
      status: 'ACTIVE',
      mfaRequired: true,
      activatedAt: new Date(),
    }).onConflictDoNothing({ target: agencyUsers.emailNormalized }).returning({
      id: agencyUsers.id,
      publicReference: agencyUsers.publicReference,
      role: agencyUsers.role,
      status: agencyUsers.status,
    });
    const record = actorRecord ?? (await transaction.select({
      id: agencyUsers.id,
      publicReference: agencyUsers.publicReference,
      role: agencyUsers.role,
      status: agencyUsers.status,
    }).from(agencyUsers).where(eq(
      agencyUsers.emailNormalized,
      DEVELOPMENT_EMAIL,
    )).limit(1))[0];
    if (!record || record.role !== 'PLATFORM_OWNER' || record.status !== 'ACTIVE') {
      throw new Error('The development knowledge operator identity is invalid.');
    }
    const actor: AgencyActor = {
      agencyUserId: record.id,
      role: 'PLATFORM_OWNER',
    };
    await audit.write(
      actor,
      'DEVELOPMENT_KNOWLEDGE_OPERATOR_BOOTSTRAPPED',
      'AGENCY_USER',
      record.id,
      {
        category: 'SECURITY',
        description: 'Created the database-only development operator for governed knowledge-pack activation.',
        sourceComponent: 'knowledge-import-cli',
        tx: transaction,
      },
    );
    return record;
  });
  process.stdout.write(`${JSON.stringify({
    mode: 'DEVELOPMENT_ACTOR_CREATED',
    actorReference: created.publicReference,
    role: created.role,
  })}\n`);
}

main()
  .catch(error => {
    process.stderr.write(`${JSON.stringify({
      code: 'DEVELOPMENT_KNOWLEDGE_ACTOR_SEED_FAILED',
      message: (error as Error).message,
    })}\n`);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
