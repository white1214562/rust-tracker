
export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    const apiKey = process.env.RUST_WIKI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({
            error: "Не настроен RUST_WIKI_API_KEY в Vercel"
        });
    }

    const allowed = {
        sort: ["players", "votes", "rating", "wiped", "name"],
        kind: ["vanilla", "modded", "official", "pure"],
        group: ["solo", "duo", "trio"],
        gather: ["2x", "3x", "5x", "10x"]
    };

    const params = new URLSearchParams();

    const sort = String(req.query.sort || "players");
    params.set("sort", allowed.sort.includes(sort) ? sort : "players");

    params.set("online", "true");

    const page = Math.max(1, Math.min(1000, Number(req.query.page) || 1));
    const perPage = Math.max(1, Math.min(100, Number(req.query.per_page) || 20));

    params.set("page", String(page));
    params.set("per_page", String(perPage));

    const search = String(req.query.search || "").trim().slice(0, 80);
    if (search) params.set("search", search);

    const country = String(req.query.country || "").trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(country)) {
        params.set("country", country);
    }

    for (const key of ["kind", "group", "gather"]) {
        const value = String(req.query[key] || "");
        if (allowed[key].includes(value)) {
            params.set(key, value);
        }
    }

    const minPlayers = Number(req.query.min_players);
    if (Number.isInteger(minPlayers) && minPlayers >= 0 && minPlayers <= 10000) {
        params.set("min_players", String(minPlayers));
    }

    try {
        const response = await fetch(
            `https://rust.wiki/api/v1/servers?${params.toString()}`,
            {
                method: "GET",
                headers: {
                    "X-API-Key": apiKey,
                    "Accept": "application/json"
                }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            console.error("Rust Wiki API:", response.status, data);

            return res.status(response.status).json({
                error: data.error || "Ошибка API серверов Rust"
            });
        }

        res.setHeader(
            "Cache-Control",
            "s-maxage=60, stale-while-revalidate=120"
        );

        return res.status(200).json({
            success: true,
            page: data.page || page,
            pages: data.pages || 1,
            total: data.total || 0,
            servers: Array.isArray(data.results) ? data.results : []
        });

    } catch (error) {
        console.error("Rust servers error:", error);

        return res.status(500).json({
            error: "Не удалось связаться с серверным API"
        });
    }
}
