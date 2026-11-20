const { createClient } = require('@supabase/supabase-js');
const { randomBytes } = require('crypto');

const {
    getAppUrl,
    parseCookies,
    createSessionCookie,
    clearSessionCookie,
    getSession
} = require('./_lib/security');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY,
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    }
);

const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const IDENTIFIER_SELECT = OPENID_NS + '/identifier_select';

module.exports = async function handler(req, res) {
    try {
        const url = new URL(req.url, getAppUrl());
        const action = url.searchParams.get('action');

        if (action === 'login' && req.method === 'GET') {
            const state = randomBytes(24).toString('hex');

            const returnTo =
                `${getAppUrl()}/api/auth?action=callback&state=${state}`;

            const params = new URLSearchParams({
                'openid.ns': OPENID_NS,
                'openid.mode': 'checkid_setup',
                'openid.return_to': returnTo,
                'openid.realm': getAppUrl(),
                'openid.identity': IDENTIFIER_SELECT,
                'openid.claimed_id': IDENTIFIER_SELECT
            });

            res.setHeader('Set-Cookie',
                `steam_login_state=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`
            );

            return res.redirect(
                'https://steamcommunity.com/openid/login?' + params.toString()
            );
        }

        if (action === 'callback' && req.method === 'GET') {
            const cookies = parseCookies(req.headers.cookie);
            const state = url.searchParams.get('state');

            if (!state || state !== cookies.steam_login_state) {
                return res.status(400).send('Ошибка проверки авторизации.');
            }

            const params = new URLSearchParams();

            for (const [key, value] of url.searchParams.entries()) {
                if (key.startsWith('openid.')) {
                    params.set(key, value);
                }
            }

            const claimedId = params.get('openid.claimed_id');
            const identity = params.get('openid.identity');

            const match = claimedId?.match(
                /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})\/?$/
            );

            if (
                params.get('openid.ns') !== OPENID_NS ||
                params.get('openid.mode') !== 'id_res' ||
                !match ||
                identity !== claimedId
            ) {
                return res.status(400).send('Некорректный ответ Steam.');
            }

            const expectedReturnTo =
                `${getAppUrl()}/api/auth?action=callback&state=${state}`;

            if (params.get('openid.return_to') !== expectedReturnTo) {
                return res.status(400).send('Неверный адрес возврата Steam.');
            }

            params.set('openid.mode', 'check_authentication');

            const verification = await fetch(
                'https://steamcommunity.com/openid/login',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: params.toString()
                }
            );

            const verificationText = await verification.text();

            if (!verification.ok || !/^is_valid:true\s*$/m.test(verificationText)) {
                return res.status(401).send('Steam не подтвердил авторизацию.');
            }

            const steamId = match[1];
            let username = 'Player_' + steamId.slice(-4);
            let avatar = '';

            if (process.env.STEAM_API_KEY) {
                try {
                    const steamUrl = new URL(
                        'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/'
                    );

                    steamUrl.searchParams.set('key', process.env.STEAM_API_KEY);
                    steamUrl.searchParams.set('steamids', steamId);

                    const response = await fetch(steamUrl);
                    const data = await response.json();
                    const player = data.response?.players?.[0];

                    if (player) {
                        username = player.personaname;
                        avatar = player.avatarfull;
                    }
                } catch (error) {
                    console.error('Steam profile error:', error.message);
                }
            }

            const { error } = await supabase
                .from('users')
                .upsert({
                    steam_id: steamId,
                    username,
                    avatar,
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'steam_id'
                });

            if (error) throw error;

            res.setHeader('Set-Cookie', [
                createSessionCookie(steamId),
                'steam_login_state=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax'
            ]);

            return res.redirect('/#rustplus');
        }

        if (action === 'me' && req.method === 'GET') {
            const steamId = getSession(req);

            if (!steamId) {
                return res.status(200).json({ loggedIn: false });
            }

            const { data: user, error } = await supabase
                .from('users')
                .select('steam_id, username, avatar, notify_heli, notify_cargo, chat_commands')
                .eq('steam_id', steamId)
                .maybeSingle();

            if (error) throw error;

            if (!user) {
                return res.status(200).json({ loggedIn: false });
            }

            return res.status(200).json({
                loggedIn: true,
                user
            });
        }

        if (action === 'settings' && req.method === 'POST') {
            const steamId = getSession(req);

            if (!steamId) {
                return res.status(401).json({ error: 'Не авторизован' });
            }

            const body = req.body || {};
            const allowed = ['notify_heli', 'notify_cargo', 'chat_commands'];
            const update = {};

            for (const key of allowed) {
                if (typeof body[key] === 'boolean') {
                    update[key] = body[key];
                }
            }

            if (!Object.keys(update).length) {
                return res.status(400).json({ error: 'Нет настроек для сохранения.' });
            }

            const { error } = await supabase
                .from('users')
                .update(update)
                .eq('steam_id', steamId);

            if (error) throw error;

            return res.status(200).json({ success: true });
        }

        if (action === 'logout' && req.method === 'GET') {
            res.setHeader('Set-Cookie', [
                clearSessionCookie(),
                'steam_login_state=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax'
            ]);

            return res.redirect('/');
        }

        return res.status(400).json({ error: 'Неизвестное действие' });

    } catch (error) {
        console.error('Auth error:', error.message);

        return res.status(500).json({
            error: 'Ошибка авторизации. Проверь настройки сервера.'
        });
    }
};
