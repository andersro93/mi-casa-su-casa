-- received_at / delete_after are now always derived from server time so a
-- sender-controlled Date: header can no longer reorder the inbox or bypass
-- retention. The header value is kept for display only.
ALTER TABLE messages ADD COLUMN date_header TEXT;
ALTER TABLE quarantine_messages ADD COLUMN date_header TEXT;
