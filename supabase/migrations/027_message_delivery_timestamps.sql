-- Add delivered_at and read_at columns to messages table
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS delivered_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS read_at timestamp with time zone;
