const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = async function handler(req, res) {
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const baseUrl = `${protocol}://${host}`;
    const action = req.query.action;

    // 1. Вход через Steam OpenID
    if (action === 'login') {
        const params = new URLSearchParams({
            'openid.ns': 'http://openid.net',
            'openid.mode': 'checkid_setup',
            'openid.return_to': `${baseUrl}/api/auth?action=callback`,
            'openid.realm': baseUrl,
            'openid.identity': 'http://openid.net/identifier_select',
            'openid.claimed_id': 'http://openid.net/identifier_select'
        });
        return res.redirect(`https://steamcommunity.com{params.toString()}`);
    }

    // 2. Возврат со страницы Steam
    if (action === 'callback') {
        const claimedId = req.query['openid.claimed_id'] || '';
        const match = claimedId.match(/\/id\/(\d+)$/);
        if (!match) return res.redirect('/?error=steam_auth_failed');

        const steamId = match[1];
        let username = `Player_${steamId.slice(-4)}`;
        let avatar = '';

        if (process.env.STEAM_API_KEY) {
            try {
                const stRes = await fetch(`https://steampowered.com{process.env.STEAM_API_KEY}&steamids=${steamId}`);
                const stData = await stRes.json();
                const player = stData.response?.players?.[0];
                if (player) {
                    username = player.personaname;
                    avatar = player.avatarfull;
                }
            } catch (e) {}
        }

        await supabase.from('users').upsert({
            steam_id: steamId,
            username,
            avatar,
            updated_at: new Date().toISOString()
        }, { onConflict: 'steam_id' });

        res.setHeader('Set-Cookie', `steam_id=${steamId}; Path=/; Max-Age=2592000; SameSite=Lax`);
        return res.redirect('/#rustplus');
    }

    // 3. Проверка статуса пользователя
    if (action === 'me') {
        const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')));
        const steamId = cookies.steam_id;
        if (!steamId) return res.status(200).json({ loggedIn: false });

        const { data: user } = await supabase.from('users').select('*').eq('steam_id', steamId).single();
        return res.status(200).json({ loggedIn: true, user });
    }

    // 4. Сохранение настроек радара (Вертолет, Карго, Команды)
    if (req.method === 'POST' && action === 'settings') {
        const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')));
        const steamId = cookies.steam_id;
        if (!steamId) return res.status(401).json({ error: 'Не авторизован' });

        const { notify_heli, notify_cargo, chat_commands } = req.body;
        await supabase.from('users').update({ notify_heli, notify_cargo, chat_commands }).eq('steam_id', steamId);
        return res.status(200).json({ success: true });
    }

    // 5. Выход из аккаунта
    if (action === 'logout') {
        res.setHeader('Set-Cookie', 'steam_id=; Path=/; Max-Age=0');
        return res.redirect('/');
    }

    return res.status(400).json({ error: 'Неизвестное действие' });
};
