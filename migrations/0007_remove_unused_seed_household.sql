-- Migration 0005 unconditionally seeded a 'home' household to carry legacy
-- single-tenant data forward. On fresh installs that left an orphan household
-- nobody belongs to: the slug 'home' could not be used at setup, mail to
-- home@<domain> landed in an invisible quarantine, and the seeded row masked
-- misconfigured routing.
--
-- Remove the seeded household only when it is clearly unused: no memberships,
-- no stored mail. Providers / sender rules under it cascade.
DELETE FROM households
WHERE id = '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
    SELECT 1 FROM household_memberships
    WHERE household_memberships.household_id = households.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM messages
    WHERE messages.household_id = households.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM quarantine_messages
    WHERE quarantine_messages.household_id = households.id
  );
