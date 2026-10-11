BEGIN;
ALTER TABLE conversations ADD COLUMN direct_key varchar(73);
-- Fail safely rather than discard or silently combine pre-existing private histories.
DO $$ BEGIN
  IF EXISTS (SELECT c.id FROM conversations c LEFT JOIN conversation_members m ON m.conversation_id=c.id
    WHERE c.access_mode='MEMBERS' AND c.conversation_type='DIRECT'
    GROUP BY c.id HAVING count(m.user_id)<>2 OR count(*) FILTER(WHERE m.left_at IS NOT NULL)>0)
  THEN RAISE EXCEPTION 'Review invalid legacy direct membership before applying Phase 3'; END IF;
END $$;
UPDATE conversations c SET direct_key=p.pair FROM (
  SELECT conversation_id,string_agg(user_id::text,':' ORDER BY user_id::text) AS pair
  FROM conversation_members GROUP BY conversation_id
) p WHERE c.id=p.conversation_id AND c.access_mode='MEMBERS' AND c.conversation_type='DIRECT';
CREATE UNIQUE INDEX conversations_direct_pair_unique ON conversations(tenant_id,direct_key) WHERE direct_key IS NOT NULL;
ALTER TABLE conversations ADD CONSTRAINT conversations_direct_key_check CHECK (
  (access_mode='MEMBERS' AND conversation_type='DIRECT' AND direct_key IS NOT NULL AND
    direct_key ~ '^[0-9a-f-]{36}:[0-9a-f-]{36}$' AND split_part(direct_key,':',1)<split_part(direct_key,':',2))
  OR ((access_mode<>'MEMBERS' OR conversation_type<>'DIRECT') AND direct_key IS NULL)
);
CREATE INDEX conversations_native_activity_idx ON conversations(tenant_id,last_message_at DESC,id DESC)
  WHERE access_mode='MEMBERS' AND archived_at IS NULL;
CREATE FUNCTION check_direct_participant() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE pair text;
BEGIN
  SELECT direct_key INTO pair FROM conversations WHERE id=NEW.conversation_id;
  IF pair IS NOT NULL AND (NEW.user_id IS NULL OR NEW.left_at IS NOT NULL OR
    NEW.user_id::text NOT IN (split_part(pair,':',1),split_part(pair,':',2))) THEN
    RAISE EXCEPTION 'DIRECT_PARTICIPANTS_FIXED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER conversation_members_direct_scope BEFORE INSERT OR UPDATE ON conversation_members
  FOR EACH ROW EXECUTE FUNCTION check_direct_participant();
REVOKE ALL ON FUNCTION check_direct_participant() FROM PUBLIC;
COMMIT;
