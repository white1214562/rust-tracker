
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.STEAM_API_KEY;
    const steamid = String(req.query.steamid || "").trim();

    if (!apiKey) {
        return res.status(500).json({
            error: "Steam API key missing"
        });
    }

    if (!/^\d{17}$/.test(steamid)) {
        return res.status(400).json({
            error: "Неверный SteamID64"
        });
    }

    try {
        const url = new URL(
            "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/"
        );

        url.searchParams.set("key", apiKey);
        url.searchParams.set("steamid", steamid);
        url.searchParams.set("include_appinfo", "true");
        url.searchParams.set("include_played_free_games", "true");
        url.searchParams.set("appids_filter[0]", "252490");

        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok) {
            return res.status(502).json({
                error: "Ошибка Steam API"
            });
        }

        const games = data.response?.games;

        if (!games) {
            return res.status(200).json({
                available: false,
                message: "Игры скрыты настройками приватности или данные недоступны"
            });
        }

        const rust = games.find(game => game.appid === 252490);

        if (!rust) {
            return res.status(200).json({
                available: true,
                ownsRust: false,
                message: "Rust не найден в доступной библиотеке"
            });
        }

        return res.status(200).json({
            available: true,
            ownsRust: true,
            name: rust.name || "Rust",
            appid: rust.appid,
            totalMinutes: rust.playtime_forever || 0,
            hours: Math.floor(
                (rust.playtime_forever || 0) / 60
            ),
            recentMinutes: rust.playtime_2weeks ?? null
        });

    } catch (error) {
        console.error("Rust stats error:", error);

        return res.status(500).json({
            error: "Не удалось получить статистику Rust"
        });
    }
}
