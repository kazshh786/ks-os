import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const replacements = {
  'apps/web/src/components/CompetitorFeatures.tsx': [
    ['Digital Signature & Agreement', 'Digital Signature and Agreement'],
    ['Completed & Collected', 'Completed and Collected'],
    ['Signature Balayage & Cut', 'Signature Balayage and Cut'],
    ['Executive Beard Sculpt & Groom', 'Executive Beard Sculpt and Groom'],
  ],
  'apps/web/src/components/ConsentFormBuilder.tsx': [
    ['Dermal & Aesthetics Consent Form', 'Dermal and Aesthetics Consent Form'],
    ['Consultation & Consent', 'Consultation and Consent'],
    ['Roll Bicycles Experience & Rating Feedback', 'Roll Bicycles Experience and Rating Feedback'],
    ['Glossy Locks Hair Care & Consultation', 'Glossy Locks Hair Care and Consultation'],
    ['Order & Consultation', 'Order and Consultation'],
    ['Dry & Damaged', 'Dry and Damaged'],
    ['Digital Signature & Full Legal Agreement', 'Digital Signature and Full Legal Agreement'],
    ['cancellation policy & general liability terms', 'cancellation policy and general liability terms'],
    ['Digital Legal Signature & Authorization', 'Digital Legal Signature and Authorization'],
    ['drag & drop canvas', 'drag-and-drop canvas'],
    ['Rating & Stars Slider', 'Rating and Stars Slider'],
  ],
  'apps/web/src/components/EntitlementUI.tsx': [
    ['team members &', 'team members and'],
  ],
  'apps/web/src/components/StaffCalendar.tsx': [
    ['Strict staff & equipment schedules enforced', 'Strict staff and equipment schedules enforced'],
    ['Private Facial & Lash Suite', 'Private Facial and Lash Suite'],
  ],
  'apps/web/src/data/mock-data-provider.ts': [
    ['Aura Aesthetics & Nails', 'Aura Aesthetics and Nails'],
    ['Beard Trim & Hot Towel Shave', 'Beard Trim and Hot Towel Shave'],
    ['Sovereign Haircut & Beard Combo', 'Sovereign Haircut and Beard Combo'],
    ['Charcoal Face Mask & Peel', 'Charcoal Face Mask and Peel'],
    ['Lash Lift & Tint', 'Lash Lift and Tint'],
    ['Brow Lamination & Shape', 'Brow Lamination and Shape'],
    ['Master Barber & Founder', 'Master Barber and Founder'],
    ['Nourishing Cuticle & Hand Cream (75ml)', 'Nourishing Cuticle and Hand Cream (75ml)'],
  ],
  'apps/web/src/features/agency/AgencyPages.tsx': [
    ['manual & online bookings', 'manual and online bookings'],
    ['advanced analytics & priority support', 'advanced analytics and priority support'],
    ['multi-location control & strategic support', 'multi-location control and strategic support'],
    ['Create & Onboard Client Business', 'Create client'],
    ['Check & Launch', 'Check launch'],
    ['set up their password and log in', 'set up their password and sign in'],
  ],
  'apps/web/src/features/reputation/ReputationPages.tsx': [
    ['Review connections & policy', 'Review connections and policy'],
  ],
  'apps/web/src/mockData.ts': [
    ['Aura Aesthetics & Nails', 'Aura Aesthetics and Nails'],
    ['Beard Trim & Hot Towel Shave', 'Beard Trim and Hot Towel Shave'],
    ['Sovereign Haircut & Beard Combo', 'Sovereign Haircut and Beard Combo'],
    ['Charcoal Face Mask & Peel', 'Charcoal Face Mask and Peel'],
    ['Lash Lift & Tint', 'Lash Lift and Tint'],
    ['Brow Lamination & Shape', 'Brow Lamination and Shape'],
    ['Facial & Lash Room A', 'Facial and Lash Room A'],
    ['Master Barber & Founder', 'Master Barber and Founder'],
    ['Nourishing Cuticle & Hand Cream (75ml)', 'Nourishing Cuticle and Hand Cream (75ml)'],
  ],
  'apps/web/src/navigation/business-navigation.ts': [
    ['Locations & Resources', 'Locations and resources'],
  ],
};

let changed = 0;
for (const [relativePath, pairs] of Object.entries(replacements)) {
  const file = path.resolve(process.cwd(), relativePath);
  let source = readFileSync(file, 'utf8');
  const before = source;
  for (const [from, to] of pairs) source = source.replaceAll(from, to);
  if (source !== before) {
    writeFileSync(file, source);
    changed += 1;
    console.log(`Updated ${relativePath}`);
  }
}

console.log(`Updated ${changed} file(s).`);
