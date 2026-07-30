import { PrequalifyQuestionnaireSchema } from '@ks-os/fact-finding';
import type { z } from 'zod';
import type { AgencyActor } from '../agency/agency.service.js';
import { BookingFactSyncService } from './booking-fact-sync.service.js';
import { FactFindingService } from './fact-finding.service.js';

export class BookingAwareFactFindingService extends FactFindingService {
  constructor(private readonly bookingFacts = new BookingFactSyncService()) {
    super();
  }

  override async prequalify(
    actor: AgencyActor,
    reference: string,
    input: z.infer<typeof PrequalifyQuestionnaireSchema>,
  ) {
    const questionnaire = await super.prequalify(actor, reference, input);
    await this.bookingFacts.sync(actor, reference);
    return this.questionnaireDetail(questionnaire.reference);
  }

  async syncBookingFacts(actor: AgencyActor, reference: string) {
    const result = await this.bookingFacts.sync(actor, reference);
    return {
      ...result,
      questionnaire: await this.questionnaireDetail(reference),
    };
  }
}
