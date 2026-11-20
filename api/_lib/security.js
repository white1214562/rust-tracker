
const {
    createHmac,
    timingSafeEqual,
    randomBytes,
    createCipheriv,
    createDecipheriv
} = require('crypto');

function getAppUrl() {
    return (process.env.APP_URL || 'https://rust-tracker-olive.vercel.app')
        .replace(/\/+$/, '');
}

function parseCookies(header = '') {
    const result = {};

    for (const part of header.split(';')) {
        const index = part.indexOf('=');
        if (index < 0) continue;

        const key = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();

        try {
            result[key] = decodeURIComponent(value);
        } catch {}
    }

    return result;
}

function sign(value) {
    if (!process.env.SESSION_SECRET) {
        throw new Error('SESSION_SECRET is missing');
    }

    return createHmac('sha256', process.env.SESSION_SECRET)
        .update(value)
        .digest('hex');
}

function createSessionCookie(steamId) {
    const expires = Math.floor(Date.now() / 1000) + 30 * 86400;
    const payload = `${steamId}.${expires}`;
    const signature = sign(payload);

    return `steam_session=${payload}.${signature}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`;
}

function clearSessionCookie() {
    return 'steam_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax';
}

function getSession(req) {
    const token = parseCookies(req.headers.cookie).steam_session;
    if (!token) return null;

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [steamId, expiresText, signature] = parts;
    const expires = Number(expiresText);

    if (!/^\d{17}$/.test(steamId)) return null;
    if (!Number.isSafeInteger(expires) || expires < Date.now() / 1000) return null;

    const expected = Buffer.from(sign(`${steamId}.${expires}`), 'hex');
    const received = Buffer.from(signature, 'hex');

    if (expected.length !== received.length) return null;
    if (!timingSafeEqual(expected, received)) return null;

    return steamId;
}

function encryptionKey() {
    const value = process.env.RUSTPLUS_ENCRYPTION_KEY || '';

    if (!/^[a-f0-9]{64}$/i.test(value)) {
        throw new Error('RUSTPLUS_ENCRYPTION_KEY must be 64 hexadecimal characters');
    }

    return Buffer.from(value, 'hex');
}

function encryptSecret(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);

    const encrypted = Buffer.concat([
        cipher.update(String(value), 'utf8'),
        cipher.final()
    ]);

    const tag = cipher.getAuthTag();

    return [
        iv.toString('base64'),
        tag.toString('base64'),
        encrypted.toString('base64')
    ].join('.');
}

function decryptSecret(value) {
    const [ivText, tagText, encryptedText] = String(value).split('.');

    if (!ivText || !tagText || !encryptedText) {
        throw new Error('Invalid encrypted value');
    }

    const decipher = createDecipheriv(
        'aes-256-gcm',
        encryptionKey(),
        Buffer.from(ivText, 'base64')
    );

    decipher.setAuthTag(Buffer.from(tagText, 'base64'));

    return Buffer.concat([
        decipher.update(Buffer.from(encryptedText, 'base64')),
        decipher.final()
    ]).toString('utf8');
}

module.exports = {
    getAppUrl,
    parseCookies,
    createSessionCookie,
    clearSessionCookie,
    getSession,
    encryptSecret,
    decryptSecret
};
