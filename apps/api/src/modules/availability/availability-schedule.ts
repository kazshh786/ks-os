export type AvailabilityMember = {
  userId: string;
  userName: string | null;
};

export type AvailabilityWindow = {
  userId: string;
  startTime: string;
  endTime: string;
};

export type AvailabilityDateOverride = AvailabilityWindow & {
  enabled: boolean;
};

export type EffectiveAvailabilityWindow = AvailabilityWindow & {
  userName: string | null;
  source: 'weekly' | 'override';
};

export type SlotWithinScheduleInput = {
  startMinute: number;
  totalDurationMinutes: number;
  scheduleEndMinute: number;
  allowAppointmentsPastClosingTime: boolean;
};

export function canOfferSlotWithinSchedule({
  startMinute,
  totalDurationMinutes,
  scheduleEndMinute,
  allowAppointmentsPastClosingTime,
}: SlotWithinScheduleInput): boolean {
  return allowAppointmentsPastClosingTime
    ? startMinute < scheduleEndMinute
    : startMinute + totalDurationMinutes <= scheduleEndMinute;
}

export function resolveEffectiveAvailabilityWindows(
  members: AvailabilityMember[],
  weeklyWindows: AvailabilityWindow[],
  dateOverrides: AvailabilityDateOverride[],
): EffectiveAvailabilityWindow[] {
  return members.flatMap<EffectiveAvailabilityWindow>(member => {
    const overrides = dateOverrides.filter(item => item.userId === member.userId);
    if (overrides.some(item => !item.enabled)) return [];
    const windows = overrides.length ? overrides : weeklyWindows.filter(item => item.userId === member.userId);
    return windows.map(window => ({ userId: member.userId, userName: member.userName,
      startTime: window.startTime, endTime: window.endTime, source: overrides.length ? 'override' as const : 'weekly' as const }));
  });
}
