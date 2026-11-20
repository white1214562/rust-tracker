
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.RUST_WIKI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({
            error: "Не настроен RUST_WIKI_API_KEY"
        });
    }

    const id = String(req.query.id || "");

    if (!/^\d{1,12}$/.test(id) || Number(id) < 1) {
        return res.status(400).json({
            error: "Некорректный ID сервера"
        });
    }

    const base = "https://rust.wiki/api/v1/servers/" + id;

    async function get(path) {
        const response = await fetch(base + path, {
            headers: {
                "X-API-Key": apiKey,
                "Accept": "application/json"
            }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || "Ошибка Rust Wiki API: " + response.status
            );
        }

        return data;
    }

    try {
        const results = await Promise.allSettled([
            get(""),
            get("/history?days=7"),
            get("/wipe-schedule"),
            get("/player-graph?range=7d"),
            get("/map")
        ]);

        const names = [
            "details",
            "history",
            "wipeSchedule",
            "playerGraph",
            "map"
        ];

        const output = {};

        results.forEach((result, index) => {
            if (result.status === "fulfilled") {
                output[names[index]] = result.value;
            } else {
                output[names[index]] = null;
                console.error(
                    "Server API " + names[index] + ":",
                    result.reason
                );
            }
        });

        if (!output.details) {
            return res.status(502).json({
                error: "Не удалось получить информацию о сервере"
            });
        }

        res.setHeader(
            "Cache-Control",
            "s-maxage=60, stale-while-revalidate=120"
        );

        return res.status(200).json({
            success: true,
            ...output
        });

    } catch (error) {
        console.error("Server detail error:", error);

        return res.status(500).json({
            error: "Ошибка загрузки страницы сервера"
        });
    }
}
