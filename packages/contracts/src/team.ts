import { z } from 'zod';

export const StaffAccountStatusSchema=z.enum(['INVITED','ACTIVE','SUSPENDED','DEACTIVATED']);
export const TeamInvitationStatusSchema=z.enum(['PENDING','ACCEPTED','EXPIRED','CANCELLED']);
export const StaffLifecycleActionSchema=z.enum(['activate','suspend','deactivate','reactivate']);
export const CreateTeamInvitationRequestSchema=z.object({email:z.string().trim().email().max(255),name:z.string().trim().min(1).max(255)}).strict();
export const TeamInvitationIdParamsSchema=z.object({invitationId:z.string().uuid()}).strict();
export const TeamMemberIdParamsSchema=z.object({staffUserId:z.string().uuid()}).strict();
export const UpdateStaffProfileRequestSchema=z.object({name:z.string().trim().min(1).max(255).optional(),jobTitle:z.string().trim().max(120).nullable().optional(),phone:z.string().trim().max(30).nullable().optional(),profileImageUrl:z.string().url().max(1000).nullable().optional(),bio:z.string().trim().max(2000).nullable().optional(),bookingEnabled:z.boolean().optional()}).strict();
export const UpdateStaffServicesRequestSchema=z.object({serviceIds:z.array(z.string().uuid()).max(200)}).strict().superRefine((v,c)=>{if(new Set(v.serviceIds).size!==v.serviceIds.length)c.addIssue({code:z.ZodIssueCode.custom,message:'Duplicate service assignment'});});
const TimeSchema=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const ScheduleIntervalSchema=z.object({dayOfWeek:z.number().int().min(0).max(6),enabled:z.boolean(),startTime:TimeSchema,endTime:TimeSchema}).strict().superRefine((v,c)=>{if(v.enabled&&v.startTime>=v.endTime)c.addIssue({code:z.ZodIssueCode.custom,message:'Start must precede end'});});
function validateSplitSchedule(value: { schedule: Array<{dayOfWeek: number; enabled: boolean; startTime: string; endTime: string}> }, context: z.RefinementCtx) {
  for (let day=0; day<7; day++) {
    const rows=value.schedule.filter(row=>row.dayOfWeek===day);
    const windows=rows.filter(row=>row.enabled).sort((a,b)=>a.startTime.localeCompare(b.startTime));
    if (windows.some((row,index)=>index>0 && row.startTime<windows[index-1].endTime))
      context.addIssue({code:z.ZodIssueCode.custom,message:'Enabled schedule windows must not overlap'});
  }
}
export const UpdateStaffScheduleRequestSchema=z.object({schedule:z.array(ScheduleIntervalSchema).max(42)}).strict().superRefine(validateSplitSchedule);
export const UpdateBookingChannelScheduleRequestSchema=z.object({channel:z.enum(['in_shop','mobile']),schedule:z.array(ScheduleIntervalSchema).max(42)}).strict().superRefine(validateSplitSchedule);
const BookingScheduleOverrideSchema=z.object({date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),channel:z.enum(['in_shop','mobile']),enabled:z.boolean(),startTime:TimeSchema.nullable().optional(),endTime:TimeSchema.nullable().optional(),note:z.string().trim().max(160).nullable().optional()}).strict().superRefine((v,c)=>{if(v.enabled){if(!v.startTime||!v.endTime)c.addIssue({code:z.ZodIssueCode.custom,message:'Open overrides require start and end times'});else if(v.startTime>=v.endTime)c.addIssue({code:z.ZodIssueCode.custom,message:'Start must precede end'});}else if(v.startTime||v.endTime)c.addIssue({code:z.ZodIssueCode.custom,message:'Closed overrides cannot include times'});});
export const UpdateBookingScheduleOverridesRequestSchema=z.object({overrides:z.array(BookingScheduleOverrideSchema).max(366)}).strict().superRefine((value,context)=>{
  const groups=new Map<string, typeof value.overrides>();
  for(const row of value.overrides){const key=row.channel+':'+row.date;groups.set(key,[...(groups.get(key)||[]),row]);}
  for(const rows of groups.values()){
    const windows=rows.filter(row=>row.enabled).sort((a,b)=>a.startTime!.localeCompare(b.startTime!));
    if((rows.some(row=>!row.enabled)&&rows.length>1)||windows.some((row,index)=>index>0&&row.startTime!<windows[index-1].endTime!))
      context.addIssue({code:z.ZodIssueCode.custom,message:'Date windows must not overlap or mix open and closed intervals'});
  }
});
export const ApplyStaffLifecycleRequestSchema=z.object({action:StaffLifecycleActionSchema,confirmed:z.literal(true)}).strict();
export type CreateTeamInvitationRequest=z.infer<typeof CreateTeamInvitationRequestSchema>;
export type UpdateStaffProfileRequest=z.infer<typeof UpdateStaffProfileRequestSchema>;
export type UpdateStaffServicesRequest=z.infer<typeof UpdateStaffServicesRequestSchema>;
export type UpdateStaffScheduleRequest=z.infer<typeof UpdateStaffScheduleRequestSchema>;
export type UpdateBookingChannelScheduleRequest=z.infer<typeof UpdateBookingChannelScheduleRequestSchema>;
export type UpdateBookingScheduleOverridesRequest=z.infer<typeof UpdateBookingScheduleOverridesRequestSchema>;
export type StaffLifecycleAction=z.infer<typeof StaffLifecycleActionSchema>;
