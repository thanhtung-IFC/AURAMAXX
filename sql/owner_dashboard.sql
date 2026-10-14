-- Run in the Supabase SQL Editor. Read-only project overview.
SELECT current_database() AS database_name, current_user AS database_user;

SELECT 'accounts' AS data_group, COUNT(*) AS records FROM visionface.accounts
UNION ALL SELECT 'face_profiles', COUNT(*) FROM visionface.people
UNION ALL SELECT 'face_samples', COUNT(*) FROM visionface.face_samples
UNION ALL SELECT 'app_users', COUNT(*) FROM public.users
UNION ALL SELECT 'habits', COUNT(*) FROM public.habit_entries
UNION ALL SELECT 'consents', COUNT(*) FROM public.user_consents
UNION ALL SELECT 'ai_conversations', COUNT(*) FROM public.ai_conversations
UNION ALL SELECT 'ai_messages', COUNT(*) FROM public.ai_messages
UNION ALL SELECT 'bot_matches', COUNT(*) FROM public.arena_bot_matches;

SELECT a.id, a.username, a.display_name, a.role, a.is_active,
       u.id AS app_user_id, u.email, a.created_at, a.last_login
FROM visionface.accounts a
LEFT JOIN public.legacy_account_links l ON l.account_id = a.id
LEFT JOIN public.users u ON u.id = l.user_id
ORDER BY a.created_at;

SELECT p.id, p.name, a.username AS owner_username,
       COUNT(s.id) AS sample_count, p.created_at
FROM visionface.people p
LEFT JOIN visionface.account_people o ON o.person_id = p.id
LEFT JOIN visionface.accounts a ON a.id = o.account_id
LEFT JOIN visionface.face_samples s ON s.person_id = p.id
GROUP BY p.id, p.name, a.username, p.created_at;

SELECT * FROM public.habit_entries ORDER BY recorded_at DESC;
SELECT * FROM public.user_consents ORDER BY created_at DESC;
SELECT * FROM public.ai_conversations ORDER BY updated_at DESC;
SELECT * FROM public.arena_bot_matches ORDER BY created_at DESC;
SELECT * FROM public.data_handoffs ORDER BY imported_at DESC;
