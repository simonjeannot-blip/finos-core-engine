
-- Widen the system_audit_log action_type constraint to support
-- Ghost/Sentinel operational events alongside the existing hash-chain actions
ALTER TABLE public.system_audit_log
DROP CONSTRAINT system_audit_log_action_type_check;

ALTER TABLE public.system_audit_log
ADD CONSTRAINT system_audit_log_action_type_check
CHECK (action_type = ANY (ARRAY[
  'INSERT', 'UPDATE', 'DELETE',
  'ENDPOINT_FAILURE', 'SYNC_SUCCESS', 'CONFIG_ERROR'
]));
