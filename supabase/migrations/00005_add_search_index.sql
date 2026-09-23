-- Enable pg_trgm extension for efficient ILIKE search
-- Run this migration when message count grows beyond ~10K
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index on message content for fast full-text search
CREATE INDEX IF NOT EXISTS idx_messages_content_trgm
  ON messages
  USING gin (content gin_trgm_ops);

-- Composite index for room-scoped search (content + room_id)
CREATE INDEX IF NOT EXISTS idx_messages_room_content
  ON messages (room_id, content);
