export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ----------------------------
    // 1. Amazon 検索API（timestamp追加版）
    // ----------------------------
    if (path === "/amazon/search" && request.method === "GET") {
      const keyword = url.searchParams.get("q");
      if (!keyword) {
        return Response.json({ error: "Missing q parameter" }, { status: 400 });
      }

      const apiUrl = `https://real-time-amazon-data.p.rapidapi.com/search?query=${encodeURIComponent(keyword)}&country=jp`;

      const res = await fetch(apiUrl, {
        method: "GET",
        headers: {
          "x-rapidapi-key": env.RAPIDAPI_KEY,
          "x-rapidapi-host": "real-time-amazon-data.p.rapidapi.com"
        }
      });

      const data = await res.json();

      if (!data?.data?.products) {
        return Response.json({ error: "No results" });
      }

      const now = new Date().toISOString();

      // 上位3件
      const results = data.data.products.slice(0, 3).map((p, idx) => ({
        rank: idx + 1,
        asin: p.asin,
        title: p.title,
        price: p.price?.current_price ?? null,
        rating: p.reviews?.rating ?? null,
        review_count: p.reviews?.total_reviews ?? null,
        url: `https://www.amazon.co.jp/dp/${p.asin}`,
        timestamp: now
      }));

      return Response.json({ results });
    }

    // ----------------------------
    // 2. Amazon 商品詳細API（ASINから詳細取得）
    // ----------------------------
    if (path === "/amazon/fetch" && request.method === "GET") {
      const asin = url.searchParams.get("asin");
      if (!asin) {
        return Response.json({ error: "Missing asin parameter" }, { status: 400 });
      }

      const apiUrl = `https://real-time-amazon-data.p.rapidapi.com/product-details?asin=${asin}&country=jp`;

      const res = await fetch(apiUrl, {
        method: "GET",
        headers: {
          "x-rapidapi-key": env.RAPIDAPI_KEY,
          "x-rapidapi-host": "real-time-amazon-data.p.rapidapi.com"
        }
      });

      const data = await res.json();

      if (!data?.data) {
        return Response.json({ error: "No product found" });
      }

      const p = data.data;

      const product = {
        product: p.title ?? null,
        price: p.price?.current_price ?? null,
        rating: p.reviews?.rating ?? null,
        review_count: p.reviews?.total_reviews ?? null,
        asin: asin,
        url: `https://www.amazon.co.jp/dp/${asin}`,
        timestamp: new Date().toISOString()
      };

      return Response.json(product);
    }

    // ----------------------------
    // 3. Notion登録（review_count修正版）
    // ----------------------------
    if (path === "/notion/import" && request.method === "POST") {
      try {
        const payload = await request.json();
        const results = [];

        // 環境変数チェック
        if (!env.NOTION_TOKEN || !env.NOTION_MASTER_DB_ID || !env.NOTION_HISTORY_DB_ID) {
          return Response.json({ 
            error: "Missing environment variables",
            details: "NOTION_TOKEN, NOTION_MASTER_DB_ID, NOTION_HISTORY_DB_ID are required"
          }, { status: 500 });
        }

        for (const r of payload.records) {
          const currentTime = new Date().toISOString();

          if (!r.asin || !r.product) {
            results.push({ 
              error: "Missing required fields (asin or product)",
              asin: r.asin 
            });
            continue;
          }

          try {
            const searchRes = await fetch(
              `https://api.notion.com/v1/databases/${env.NOTION_MASTER_DB_ID}/query`,
              {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${env.NOTION_TOKEN}`,
                  "Notion-Version": "2022-06-28",
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  filter: {
                    property: "ASIN",
                    rich_text: { equals: r.asin }
                  }
                })
              }
            );

            const searchData = await searchRes.json();
            const exists = searchData.results && searchData.results.length > 0;
            let masterResult;

            const validUrl = r.url && r.url.startsWith('http') ? r.url : `https://www.amazon.co.jp/dp/${r.asin}`;
            const validPrice = typeof r.price === "number" ? r.price : null;
            const validRating = typeof r.rating === "number" ? r.rating : null;
            const validReviews = 
              typeof r.review_count === "number" && !isNaN(r.review_count)
                ? r.review_count
                : null;

            const notionProps = {
              Name: { title: [{ text: { content: r.product } }] },
              Price: validPrice !== null ? { number: validPrice } : {},
              Rating: validRating !== null ? { number: validRating } : {},
              Reviews: validReviews !== null ? { number: validReviews } : {},
              URL: { url: validUrl },
              ASIN: { rich_text: [{ text: { content: r.asin } }] },
              UpdatedAt: { date: { start: currentTime } }
            };

            const notionBody = JSON.stringify({
              parent: { database_id: env.NOTION_MASTER_DB_ID },
              properties: notionProps
            });

            if (exists) {
              const pageId = searchData.results[0].id;
              const updateRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
                method: "PATCH",
                headers: {
                  "Authorization": `Bearer ${env.NOTION_TOKEN}`,
                  "Notion-Version": "2022-06-28",
                  "Content-Type": "application/json"
                },
                body: notionBody
              });
              masterResult = await updateRes.json();
            } else {
              const createRes = await fetch("https://api.notion.com/v1/pages", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${env.NOTION_TOKEN}`,
                  "Notion-Version": "2022-06-28",
                  "Content-Type": "application/json"
                },
                body: notionBody
              });
              masterResult = await createRes.json();
            }

            // 履歴DB
            const historyRes = await fetch("https://api.notion.com/v1/pages", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${env.NOTION_TOKEN}`,
                "Notion-Version": "2022-06-28",
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                parent: { database_id: env.NOTION_HISTORY_DB_ID },
                properties: {
                  Product: { rich_text: [{ text: { content: r.product } }] },
                  Price: validPrice !== null ? { number: validPrice } : {},
                  Rating: validRating !== null ? { number: validRating } : {},
                  Reviews: validReviews !== null ? { number: validReviews } : {},
                  ASIN: { rich_text: [{ text: { content: r.asin } }] },
                  Timestamp: { date: { start: currentTime } }
                }
              })
            });

            const historyResult = await historyRes.json();

            results.push({ master: masterResult, history: historyResult });

          } catch (err) {
            results.push({ error: err.message, asin: r.asin });
          }
        }

        return Response.json({ ok: true, count: payload.records.length, results });

      } catch (err) {
        return Response.json({ error: "Internal server error", message: err.message }, { status: 500 });
      }
    }

    // ----------------------------
    // Default
    // ----------------------------
    return new Response("Agent2Notion Worker / Real-Time Amazon Data API OK");
  }
};
