import { and, eq, sql } from 'drizzle-orm';
import { getDatabase, operationsIssues } from '@ks-os/database';
import type { OperationsIssueCategory, OperationsIssueSeverity, OperationsIssueSourceType, OperationsIssueType } from '@ks-os/contracts';

export type ReportOperationsIssue={tenantId:string;category:OperationsIssueCategory;issueType:OperationsIssueType;severity:OperationsIssueSeverity;title:string;message:string;sourceType:OperationsIssueSourceType;sourceId:string;deduplicationKey:string;relatedAppointmentId?:string|null;actionDeadline?:Date|null;metadata?:Record<string,unknown>};
export const operationsDeduplicationKey=(issueType:OperationsIssueType,sourceId:string)=>`${issueType}:${sourceId}`;

export class OperationsIssueReporter {
  async report(input:ReportOperationsIssue, tx?:any){const db=tx??getDatabase();const now=new Date();
    const [issue]=await db.insert(operationsIssues).values({...input,metadataJson:input.metadata??{},occurredAt:now,lastOccurredAt:now})
      .onConflictDoUpdate({target:[operationsIssues.tenantId,operationsIssues.deduplicationKey],set:{category:input.category,issueType:input.issueType,severity:input.severity,title:input.title,message:input.message,sourceType:input.sourceType,sourceId:input.sourceId,relatedAppointmentId:input.relatedAppointmentId??null,actionDeadline:input.actionDeadline??null,metadataJson:input.metadata??{},status:'OPEN',lastOccurredAt:now,occurrenceCount:sql`${operationsIssues.occurrenceCount} + 1`,acknowledgedAt:null,acknowledgedByUserId:null,resolvedAt:null,resolvedByUserId:null,dismissedAt:null,updatedAt:now}}).returning();return issue;
  }
  async resolve(tenantId:string,deduplicationKey:string, tx?:any){const db=tx??getDatabase();await db.update(operationsIssues).set({status:'RESOLVED',resolvedAt:new Date(),updatedAt:new Date()}).where(and(eq(operationsIssues.tenantId,tenantId),eq(operationsIssues.deduplicationKey,deduplicationKey),sql`${operationsIssues.status} IN ('OPEN','ACKNOWLEDGED')`));}
}
