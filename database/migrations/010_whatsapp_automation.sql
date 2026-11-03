-- Channel metadata only. Financial tables and customer records are unchanged.
ALTER TABLE messages ADD COLUMN automation_context JSON NULL;
