ALTER TABLE person_roles ADD COLUMN role_scope TEXT NOT NULL DEFAULT 'other'
  CHECK (role_scope IN ('executive', 'branch_head', 'auditor', 'committee', 'staff_rotating', 'external_rep', 'other'));
ALTER TABLE person_roles ADD COLUMN term_label TEXT NOT NULL DEFAULT '';
ALTER TABLE person_roles ADD COLUMN appointed_on TEXT;
ALTER TABLE person_roles ADD COLUMN ended_on TEXT;
ALTER TABLE person_roles ADD COLUMN end_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE person_roles ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 100;
ALTER TABLE person_roles ADD COLUMN evidence_doc_id TEXT NOT NULL DEFAULT '';
ALTER TABLE person_roles ADD COLUMN note TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_person_roles_scope_order ON person_roles(role_scope, sort_order, role_id);
