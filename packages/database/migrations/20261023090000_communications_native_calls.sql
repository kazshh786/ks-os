-- Phase 8: one instant-call response belongs to one authenticated provider session.
-- Provider session identifiers are audit values, deliberately not FKs to auth.sessions:
-- deleting a provider session must not erase the historical call response.
ALTER TABLE public.communication_meeting_participants
 ADD COLUMN response_auth_session_id uuid,
 ADD COLUMN response_request_id uuid;
ALTER TABLE public.communication_meeting_participants
 DROP CONSTRAINT communication_meeting_participants_invitation_state_check;
ALTER TABLE public.communication_meeting_participants
 ADD CONSTRAINT communication_meeting_participants_invitation_state_check CHECK(invitation_state IN ('INVITED','ACCEPTED','DECLINED','REMOVED','MISSED')),
 ADD CONSTRAINT communication_meeting_response_request CHECK(response_request_id IS NULL OR response_auth_session_id IS NOT NULL);
COMMENT ON COLUMN public.communication_meeting_participants.response_auth_session_id IS 'Winning authenticated session for instant-call acceptance/decline. Scheduled meetings retain their existing multi-device admission policy.';
CREATE INDEX communication_meeting_response_session ON public.communication_meeting_participants(response_auth_session_id) WHERE response_auth_session_id IS NOT NULL;

-- No grants change: the existing API-only participant table remains inaccessible
-- to anon/authenticated. Migration is additive apart from widening a state CHECK.
