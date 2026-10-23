-- Phase 8: a committed per-tenant position on the existing event journal.
-- Unlike a sequence default, the counter row stays locked until commit. A reader
-- cannot advance past an event whose writer has not committed yet.
CREATE TABLE communication_sync_state (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  position bigint NOT NULL DEFAULT 0 CHECK (position >= 0),
  replay_floor bigint NOT NULL DEFAULT 0 CHECK (replay_floor >= 0 AND replay_floor <= position)
);
ALTER TABLE communication_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON communication_sync_state FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON communication_sync_state TO service_role;
ALTER TABLE communication_events ADD COLUMN sync_position bigint;
WITH ordered AS (
  SELECT id,row_number() OVER (PARTITION BY tenant_id ORDER BY id) AS position FROM communication_events
) UPDATE communication_events e SET sync_position=o.position FROM ordered o WHERE o.id=e.id;
INSERT INTO communication_sync_state(tenant_id,position)
SELECT tenant_id,max(sync_position) FROM communication_events GROUP BY tenant_id;
ALTER TABLE communication_events ALTER COLUMN sync_position SET NOT NULL;
CREATE UNIQUE INDEX communication_events_sync_idx ON communication_events(tenant_id,sync_position);

CREATE FUNCTION communication_assign_sync_position() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  INSERT INTO public.communication_sync_state(tenant_id,position) VALUES(NEW.tenant_id,1)
    ON CONFLICT(tenant_id) DO UPDATE SET position=communication_sync_state.position+1
    RETURNING position INTO NEW.sync_position;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION communication_assign_sync_position() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER communication_assign_sync_position BEFORE INSERT ON communication_events
FOR EACH ROW EXECUTE FUNCTION communication_assign_sync_position();

-- Pruning any part of a replay interval must cause a reset, never silent loss.
CREATE FUNCTION communication_advance_replay_floor() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  UPDATE public.communication_sync_state SET replay_floor=greatest(replay_floor,OLD.sync_position)
    WHERE tenant_id=OLD.tenant_id;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION communication_advance_replay_floor() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER communication_advance_replay_floor AFTER DELETE ON communication_events
FOR EACH ROW EXECUTE FUNCTION communication_advance_replay_floor();
