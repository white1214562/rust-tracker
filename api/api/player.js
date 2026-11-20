
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.STEAM_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: "Steam API key missing" });
    }

    try {
        const input = String(req.query.steamid || "").trim();

        if (!input || input.length > 100) {
            return res.status(400).json({ error: "Введите SteamID или ник" });
        }

        let steamId = input;

        if (!/^\d{17}$/.test(input)) {
            const url = new URL(
                "https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/"
            );

            url.searchParams.set("key", apiKey);
            url.searchParams.set("vanityurl", input);

            const response = await fetch(url);
            const data = await response.json();

            if (data.response?.success !== 1) {
                return res.status(404).json({ error: "Игрок не найден" });
            }

            steamId = data.response.steamid;
        }

        const url = new URL(
            "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"
        );

        url.searchParams.set("key", apiKey);
        url.searchParams.set("steamids", steamId);

        const response = await fetch(url);
        const data = await response.json();

        const player = data.response?.players?.[0];

        if (!player) {
            return res.status(404).json({ error: "Профиль не найден" });
        }

        return res.status(200).json({
            steamid: player.steamid,
            name: player.personaname,
            avatar: player.avatarfull,
            profile: player.profileurl,
            visibility: player.communityvisibilitystate,
            created: player.timecreated || null
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            error: "Ошибка Steam API"
        });
    }
}
