const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function parseCookies(cookieHeader) {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(';').forEach((cookie) => {
        const parts = cookie.split('=');
        const key = parts.shift().trim();
        if (key) list[key] = decodeURIComponent(parts.join('='));
    });
    return list;
}

module.exports = async function handler(req, res) {
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const baseUrl = protocol + '://' + host;
    const action = req.query.action;

    // 1. Вход через Steam OpenID
    if (action === 'login') {
        const openidNs = 'http://openid.net' + '/auth/2.0';
        const openidId = openidNs + '/identifier_select';
        const params = new URLSearchParams({
            'openid.ns': openidNs,
            'openid.mode': 'checkid_setup',
            'openid.return_to': baseUrl + '/api/auth?action=callback',
            'openid.realm': baseUrl,
            'openid.identity': openidId,
            'openid.claimed_id': openidId
        });
        const steamLoginUrl = 'https://steamcommunity.com' + '/openid/login?' + params.toString();
        return res.redirect(steamLoginUrl);
    }

    // 2. Обработка ответа от Steam после авторизации
    if (action === 'callback') {
        const claimedId = req.query['openid.claimed_id'] || '';
        const match = claimedId.match(/\/id\/(\d+)$/);
        if (!match) return res.redirect('/?error=steam_auth_failed');

        const steamId = match.at(1);
        let username = 'Player_' + steamId.slice(-4);
        let avatar = '';

        if (process.env.STEAM_API_KEY) {
            try {
                const apiUrl = 'https://steampowered.com' + '/ISteamUser/GetPlayerSummaries/v2/?key=' + process.env.STEAM_API_KEY + '&steamids=' + steamId;
                const stRes = await fetch(apiUrl);
                const stData = await stRes.json();
                const player = stData.response?.players?.at(0);
                if (player) {
                    username = player.personaname;
                    avatar = player.avatarfull;
                }
            } catch (e) {}
        }

        await supabase.from('users').upsert({
            steam_id: steamId,
            username: username,
            avatar: avatar,
            updated_at: new Date().toISOString()
        }, { onConflict: 'steam_id' });

        res.setHeader('Set-Cookie', 'steam_id=' + steamId + '; Path=/; Max-Age=2592000; SameSite=Lax');
        return res.redirect('/#rustplus');
    }

    // 3. Проверка статуса пользователя
    if (action === 'me') {
        const cookies = parseCookies(req.headers.cookie);
        const steamId = cookies.steam_id;
        if (!steamId) return res.status(200).json({ loggedIn: false });

        const { data: user } = await supabase.from('users').select('*').eq('steam_id', steamId).single();
        return res.status(200).json({ loggedIn: true, user: user });
    }

    // 4. Обновление настроек радара
    if (req.method === 'POST' && action === 'settings') {
        const cookies = parseCookies(req.headers.cookie);
        const steamId = cookies.steam_id;
        if (!steamId) return res.status(401).json({ error: 'Не авторизован' });

        const { notify_heli, notify_cargo, chat_commands } = req.body;
        await supabase.from('users').update({ notify_heli: notify_heli, notify_cargo: notify_cargo, chat_commands: chat_commands }).eq('steam_id', steamId);
        return res.status(200).json({ success: true });
    }

    // 5. Выход из аккаунта
    if (action === 'logout') {
        res.setHeader('Set-Cookie', 'steam_id=; Path=/; Max-Age=0');
        return res.redirect('/');
    }

    return res.status(400).json({ error: 'Неизвестное действие' });
};
