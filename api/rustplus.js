const RustPlus = require('@liamcottle/rustplus.js');

module.exports = async function handler(req, res) {
    // Разрешаем только POST-запросы от твоего сайта
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Метод не разрешен. Используйте POST.' });
    }

    const { ip, port, playerId, playerToken, message } = req.body || {};

    if (!ip || !port || !playerId || !playerToken || !message) {
        return res.status(400).json({ error: 'Заполните все поля: IP, Порт, SteamID, Токен и Сообщение.' });
    }

    return new Promise((resolve) => {
        const rustplus = new RustPlus(ip, Number(port), playerId, Number(playerToken));

        // Защита от зависания: если сервер не ответил за 8 секунд, закрываем соединение
        const timeout = setTimeout(() => {
            rustplus.disconnect();
            res.status(504).json({ error: 'Сервер Rust не ответил. Проверьте IP и порт Rust+.' });
            resolve();
        }, 8000);

        // Как только подключились к серверу — отправляем сообщение в чат команды
        rustplus.on('connected', () => {
            rustplus.sendTeamMessage(`[RUST RADAR] ${message}`, (msg) => {
                clearTimeout(timeout);
                rustplus.disconnect();

                if (msg.response && msg.response.error) {
                    res.status(400).json({ error: 'Ошибка Rust+: вы должны состоять в команде на сервере.' });
                } else {
                    res.status(200).json({ success: true, info: 'Сообщение отправлено в командный чат!' });
                }
                resolve();
            });
        });

        // Обработка ошибок подключения (неверный токен, закрытый порт и т.д.)
        rustplus.on('error', (err) => {
            clearTimeout(timeout);
            res.status(500).json({ error: 'Ошибка подключения: ' + err.message });
            resolve();
        });

        rustplus.connect();
    });
};
