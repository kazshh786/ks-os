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

export function resolveEffectiveAvailabilityWindows(
  members: AvailabilityMember[],
  weeklyWindows: AvailabilityWindow[],
  dateOverrides: AvailabilityDateOverride[],
): EffectiveAvailabilityWindow[] {
  return members.flatMap(member => {
    const override = dateOverrides.find(item => item.userId === member.userId);
    if (override) {
      if (!override.enabled) return [];
      return [{
        userId: member.userId,
        userName: member.userName,
        startTime: override.startTime,
        endTime: override.endTime,
        source: 'override' as const,
      }];
    }

    const weekly = weeklyWindows.find(item => item.userId === member.userId);
    if (!weekly) return [];
    return [{
      userId: member.userId,
      userName: member.userName,
      startTime: weekly.startTime,
      endTime: weekly.endTime,
      source: 'weekly' as const,
    }];
  });
}
