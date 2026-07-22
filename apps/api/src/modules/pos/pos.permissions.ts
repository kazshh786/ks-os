import { SQL, eq } from 'drizzle-orm';
import { appointments } from '@ks-os/database';

export function getPosAppointmentFilter(role: string, authUserId: string): SQL | undefined {
  if (role !== 'owner') {
    return eq(appointments.userId, authUserId);
  }
  return undefined;
}
