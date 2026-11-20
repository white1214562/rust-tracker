
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.STEAM_API_KEY;
    const steamid = String(req.query.steamid || "").trim();

    if (!apiKey) {
        return res.status(500).json({ error: "Steam API key missing" });
    }

    if (!/^\d{17}$/.test(steamid)) {
        return res.status(400).json({ error: "Неверный SteamID64" });
    }

    const appid = "252490";

    async function steamRequest(endpoint, params = {}) {
        const url = new URL(
            `https://api.steampowered.com/${endpoint}`
        );

        url.searchParams.set("key", apiKey);

        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, String(value));
        }

        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(`Steam API error: ${response.status}`);
        }

        return data;
    }

    try {
        const [ownedResult, statsResult, achievementsResult, bansResult] =
            await Promise.allSettled([
                steamRequest("IPlayerService/GetOwnedGames/v1/", {
                    steamid,
                    include_appinfo: true,
                    include_played_free_games: true,
                    "appids_filter[0]": appid
                }),

                steamRequest("ISteamUserStats/GetUserStatsForGame/v0002/", {
                    steamid,
                    appid
                }),

                steamRequest("ISteamUserStats/GetPlayerAchievements/v0001/", {
                    steamid,
                    appid,
                    l: "russian"
                }),

                steamRequest("ISteamUser/GetPlayerBans/v1/", {
                    steamids: steamid
                })
            ]);

        let game = null;

        if (ownedResult.status === "fulfilled") {
            const games = ownedResult.value.response?.games || [];
            game = games.find(item => Number(item.appid) === Number(appid)) || null;
        }

        const statsData = statsResult.status === "fulfilled"
            ? statsResult.value.playerstats
            : null;

        const rawStats = statsData?.stats || [];

        const normalized = rawStats.map(item => ({
            name: String(item.name || ""),
            value: Number(item.value) || 0
        }));

        function findStat(patterns) {
            for (const pattern of patterns) {
                const found = normalized.find(item =>
                    item.name.toLowerCase() === pattern
                );

                if (found) return found.value;
            }

            return null;
        }

        const kills = findStat([
            "player kills",
            "kills"
        ]);

        const deaths = findStat([
            "player deaths",
            "deaths"
        ]);

        const kd = kills !== null && deaths !== null
            ? Number((kills / Math.max(deaths, 1)).toFixed(2))
            : null;

        let achievements = null;

        if (achievementsResult.status === "fulfilled") {
            const achievementData =
                achievementsResult.value.playerstats;

            if (achievementData?.success) {
                const list = achievementData.achievements || [];

                achievements = {
                    unlocked: list.filter(item => item.achieved === 1).length,
                    total: list.length,
                    items: list.map(item => ({
                        name: item.name,
                        description: item.description || "",
                        achieved: item.achieved === 1,
                        unlockTime: item.unlocktime || 0
                    }))
                };
            }
        }

        let bans = null;

        if (bansResult.status === "fulfilled") {
            const player = bansResult.value.players?.[0];

            if (player) {
                bans = {
                    vacBanned: player.VACBanned,
                    gameBanned: player.NumberOfGameBans,
                    vacBans: player.NumberOfVACBans,
                    daysSinceLastBan: player.DaysSinceLastBan,
                    economyBan: player.EconomyBan
                };
            }
        }

        return res.status(200).json({
            available: Boolean(game),
            ownsRust: Boolean(game),

            name: game?.name || "Rust",
            appid: Number(appid),

            totalMinutes: game?.playtime_forever ?? null,
            hours: game
                ? Math.floor((game.playtime_forever || 0) / 60)
                : null,

            recentMinutes: game?.playtime_2weeks ?? null,

            statsAvailable: Boolean(statsData?.success),
            statsError: statsData?.error || null,

            kills,
            deaths,
            kd,

            allStats: normalized,

            achievements,
            bans
        });

    } catch (error) {
        console.error("Rust stats error:", error);

        return res.status(500).json({
            error: "Не удалось получить статистику Rust"
        });
    }
}
