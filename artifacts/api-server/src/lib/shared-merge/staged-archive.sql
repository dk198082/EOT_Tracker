-- DISPOSABLE VALIDATION ONLY. Not a live migration or startup script.
-- Load the approved transformed rows BEFORE installing this schema. Nothing in
-- this file chooses archive scope, copies data, or renumbers existing requests.
DO $$ BEGIN
  IF current_database() <> 'eto_archive_validation' THEN
    RAISE EXCEPTION 'This schema may only run in the disposable archive validation database';
  END IF;
END $$;

CREATE TABLE crm.eto_merge_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  schema_version integer NOT NULL CHECK (schema_version=1),
  epoch text NOT NULL CHECK (length(epoch)>0)
);
-- Synthetic marker; a future approved installer must use its approved epoch.
INSERT INTO crm.eto_merge_state VALUES (true, 1, 'disposable-archive-epoch');

ALTER TABLE crm.eto_requests
  ADD COLUMN record_key text NOT NULL DEFAULT gen_random_uuid()::text,
  ADD COLUMN migration_epoch text NOT NULL DEFAULT 'disposable-archive-epoch',
  ADD COLUMN is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN archive_source text NOT NULL DEFAULT 'shared' CHECK (archive_source IN ('production','workspace','shared')),
  ADD COLUMN archive_source_id integer,
  ADD COLUMN archive_reason text,
  ADD CONSTRAINT eto_record_key_unique UNIQUE (record_key),
  ADD CONSTRAINT eto_archive_reason_required CHECK (NOT is_archived OR (archive_source='workspace' AND archive_reason IS NOT NULL));

-- The fixture harness sets the exact approved provenance/archive rows here,
-- before protections are installed. This script is split at this marker.
-- FIXTURE_PROVENANCE

UPDATE crm.eto_requests SET archive_source_id=id WHERE archive_source_id IS NULL;
ALTER TABLE crm.eto_requests ALTER COLUMN archive_source_id SET NOT NULL;

-- Replace only the historical single-column global ETO number uniqueness.
-- Compound split-family protections remain intact.
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT conname FROM pg_constraint
    WHERE conrelid='crm.eto_requests'::regclass AND contype='u'
      AND conkey=ARRAY[(SELECT attnum FROM pg_attribute
        WHERE attrelid='crm.eto_requests'::regclass AND attname='eto_number')]::smallint[]
  LOOP EXECUTE format('ALTER TABLE crm.eto_requests DROP CONSTRAINT %I', item.conname); END LOOP;
END $$;
CREATE UNIQUE INDEX eto_active_number_unique ON crm.eto_requests(eto_number)
  WHERE NOT is_archived AND eto_number IS NOT NULL;
CREATE TABLE crm.eto_number_registry (
  eto_number text PRIMARY KEY
);
INSERT INTO crm.eto_number_registry SELECT DISTINCT eto_number FROM crm.eto_requests WHERE eto_number IS NOT NULL;

CREATE FUNCTION crm.eto_protect_number() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,crm AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.eto_number IS NOT NULL AND NEW.eto_number IS DISTINCT FROM OLD.eto_number THEN
    RAISE EXCEPTION 'ASSIGNED_NUMBER_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF NEW.eto_number IS NOT NULL AND (TG_OP='INSERT' OR OLD.eto_number IS NULL) THEN
    -- Registry insertion serializes races and includes archived/split numbers.
    BEGIN
      INSERT INTO crm.eto_number_registry VALUES (NEW.eto_number);
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'HISTORICAL_NUMBER_ALREADY_USED' USING ERRCODE='23505';
    END;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER eto_number_guard BEFORE INSERT OR UPDATE ON crm.eto_requests
  FOR EACH ROW EXECUTE FUNCTION crm.eto_protect_number();

CREATE FUNCTION crm.eto_protect_archive() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_parent integer; new_parent integer; BEGIN
  IF TG_TABLE_NAME='eto_requests' THEN
    IF TG_OP='INSERT' THEN
      NEW.record_key := gen_random_uuid()::text;
      NEW.migration_epoch := (SELECT epoch FROM crm.eto_merge_state WHERE singleton);
      NEW.is_archived := false;
      NEW.archive_source := 'shared';
      NEW.archive_source_id := NEW.id;
      NEW.archive_reason := NULL;
      RETURN NEW;
    END IF;
    IF OLD.is_archived THEN RAISE EXCEPTION 'ARCHIVED_READ_ONLY' USING ERRCODE='55000'; END IF;
    IF TG_OP='UPDATE' AND (NEW.record_key, NEW.migration_epoch, NEW.is_archived, NEW.archive_source, NEW.archive_source_id, NEW.archive_reason)
      IS DISTINCT FROM (OLD.record_key, OLD.migration_epoch, OLD.is_archived, OLD.archive_source, OLD.archive_source_id, OLD.archive_reason) THEN
      RAISE EXCEPTION 'RECORD_PROVENANCE_IMMUTABLE' USING ERRCODE='55000';
    END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN old_parent := OLD.eto_request_id; END IF;
    IF TG_OP <> 'DELETE' THEN new_parent := NEW.eto_request_id; END IF;
    -- Lock/check both parents: moving rows into OR out of archives is forbidden.
    PERFORM id FROM crm.eto_requests WHERE id IN (old_parent,new_parent) FOR SHARE;
    IF EXISTS (SELECT 1 FROM crm.eto_requests WHERE id IN (old_parent,new_parent) AND is_archived) THEN
      RAISE EXCEPTION 'ARCHIVED_READ_ONLY' USING ERRCODE='55000';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['eto_requests','eto_comments','eto_attachments','eto_stage_transitions',
    'eto_detail_changes','eto_engineering_outputs','eto_production_outputs','eto_art_final_outputs','eto_price_calculator']
  LOOP
    EXECUTE format('CREATE TRIGGER eto_archive_write_guard BEFORE INSERT OR UPDATE OR DELETE ON crm.%I FOR EACH ROW EXECUTE FUNCTION crm.eto_protect_archive()', name);
  END LOOP;
END $$;
-- Runtime role must have SELECT only on marker/registry, no ability to change
-- provenance, disable guards, or truncate protected tables. Deployment grants
-- and owner separation are separate installation gates, not performed here.
