ALTER TABLE profiles ADD COLUMN IF NOT EXISTS can_view_statistics boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE profiles SET can_view_statistics = true, updated_at = now()
WHERE lower(username) IN ('emrebot', 'numanbaba');
