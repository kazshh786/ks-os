-- SQL Migration: Module 8 - Time Blocking / Personal Busy Slots
-- Run this inside your Supabase SQL Editor to make client_name and service_id optional for blocked slots.

ALTER TABLE public.appointments ALTER COLUMN client_name DROP NOT NULL;
ALTER TABLE public.appointments ALTER COLUMN service_id DROP NOT NULL;

-- If you have a check constraint on appointments.status, drop and recreate it to include 'BLOCKED'
-- If you don't have constraints, this acts as a safety update.
DO $$
BEGIN
    ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
    ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check 
        CHECK (status IN ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'BLOCKED'));
EXCEPTION
    WHEN undefined_object THEN
        -- If no constraint was found, just create it
        ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check 
            CHECK (status IN ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'BLOCKED'));
END $$;
