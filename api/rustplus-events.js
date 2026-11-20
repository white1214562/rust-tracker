
const { createClient } = require('@supabase/supabase-js');
const { getSession } = require('./_lib/security');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY,
    { auth: { persistSession: false } }
);

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Используйте GET' });
    }

    try {
        const steamId = getSession(req);

        if (!steamId) {
            return res.status(401).json({ error: 'Не авторизован' });
        }

        const requestedLimit = Number(req.query.limit || 50);
        const limit = Number.isFinite(requestedLimit)
            ? Math.min(100, Math.max(1, Math.floor(requestedLimit)))
            : 50;

        const { data, error } = await supabase
            .from('rustplus_events')
            .select('id, server_ip, event_type, event_data, created_at')
            .eq('steam_id', steamId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;

        return res.status(200).json({
            success: true,
            events: data || []
        });

    } catch (error) {
        console.error('Rust+ events error:', error.message);
        return res.status(500).json({ error: 'Не удалось получить историю событий' });
    }
};
