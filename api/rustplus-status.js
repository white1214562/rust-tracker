
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

        const { data, error } = await supabase
            .from('rustplus_connections')
            .select('id, server_name, server_ip, app_port, status, paired_at, last_seen')
            .eq('steam_id', steamId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        return res.status(200).json({
            success: true,
            connections: data || []
        });

    } catch (error) {
        console.error('Rust+ status error:', error.message);
        return res.status(500).json({ error: 'Не удалось получить статус Rust+' });
    }
};
