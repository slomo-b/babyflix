//! Keyless IMDb metadata.
//! - Title -> IMDb id / poster / top-cast via the public suggestion API.
//! - Real IMDb rating/votes come from the local dataset index (see `ratings.rs`).
//! - `fetch_by_id` (IMDb GraphQL) is an optional best-effort extra; it may be blocked.
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

use crate::xtream::UA;

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct ImdbInfo {
    pub imdb_id: Option<String>,
    pub title: Option<String>,
    pub year: Option<i32>,
    pub rating: Option<f64>,
    pub votes: Option<u64>,
    pub image: Option<String>,
    pub plot: Option<String>,
    pub genres: Vec<String>,
    pub runtime_minutes: Option<i32>,
    pub cast: Vec<String>,
    pub director: Option<String>,
    pub kind: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct Suggestion {
    pub id: String,
    pub title: String,
    pub year: Option<i32>,
    pub image: Option<String>,
    pub cast: Vec<String>,
    pub is_series: bool,
}

fn norm_key(title: &str) -> String {
    title
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn wants_series(kind: &str) -> bool {
    kind == "series" || kind == "tv"
}

/// Resolve a title/year to the best matching IMDb suggestion entry.
pub async fn resolve(
    client: &reqwest::Client,
    title: &str,
    year: Option<i32>,
    kind: &str,
) -> Option<Suggestion> {
    let q = norm_key(title);
    if q.is_empty() {
        return None;
    }
    let url = format!(
        "https://v3.sg.media-imdb.com/suggestion/titles/x/{}.json",
        percent_encoding::utf8_percent_encode(&q, percent_encoding::NON_ALPHANUMERIC)
    );
    let resp = client
        .get(&url)
        .header("User-Agent", UA)
        .header("Accept", "application/json")
        .timeout(Duration::from_secs(12))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let v: Value = resp.json().await.ok()?;
    let list = v.get("d").and_then(|d| d.as_array())?;
    let series = wants_series(kind);
    let mut best: Option<(i64, Suggestion)> = None;
    for hit in list {
        let id = hit.get("id").and_then(|x| x.as_str()).unwrap_or_default();
        if !id.starts_with("tt") {
            continue;
        }
        let qid = hit.get("qid").and_then(|x| x.as_str()).unwrap_or("");
        let is_series = matches!(qid, "tvSeries" | "tvMiniSeries");
        let is_movie = matches!(qid, "movie" | "tvMovie" | "video" | "short");
        if (series && !is_series) || (!series && !is_movie) {
            continue;
        }
        let mut score: i64 = 100;
        let hy = hit.get("y").and_then(|x| x.as_i64());
        if let (Some(y), Some(hy)) = (year, hy) {
            score -= ((hy - y as i64).abs().min(20)) * 3;
        }
        let label = hit.get("l").and_then(|x| x.as_str()).unwrap_or("");
        if norm_key(label) == q {
            score += 40;
        }
        if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
            let img = hit
                .get("i")
                .and_then(|i| i.get("imageUrl"))
                .and_then(|x| x.as_str())
                .map(String::from);
            let cast = hit
                .get("s")
                .and_then(|s| s.as_str())
                .map(|s| s.split(", ").map(String::from).collect())
                .unwrap_or_default();
            best = Some((
                score,
                Suggestion {
                    id: id.to_string(),
                    title: label.to_string(),
                    year: hy.map(|y| y as i32),
                    image: img,
                    cast,
                    is_series,
                },
            ));
        }
    }
    best.map(|(_, s)| s)
}

const G_META: &str = r#"
query BabyFlixTitle($id: ID!) {
  title(id: $id) {
    id
    titleText { text }
    titleType { id }
    releaseYear { year }
    runtime { seconds }
    ratingsSummary { aggregateRating voteCount }
    plot { plotText { plainText } }
    genres { genres { text } }
    primaryImage { url width height }
    principalCredits(first: 8) {
      category { id }
      credits {
        name { id nameText { text } }
        ... on Cast { characters { name } }
      }
    }
  }
}
"#;

/// Best-effort rich metadata via IMDb's public GraphQL (may be blocked with 403).
#[allow(dead_code)]
pub async fn fetch_by_id(client: &reqwest::Client, imdb_id: &str) -> Result<ImdbInfo> {
    let body = serde_json::json!({ "query": G_META, "variables": { "id": imdb_id } });
    let resp = client
        .post("https://caching.graphql.imdb.com/")
        .header("User-Agent", UA)
        .header("content-type", "application/json")
        .header("accept", "application/graphql+json, application/json")
        .header("origin", "https://www.imdb.com")
        .header("referer", "https://www.imdb.com/")
        .header("x-imdb-client-name", "imdb-web-next")
        .header("x-imdb-user-language", "en-US")
        .header("x-imdb-user-country", "US")
        .timeout(Duration::from_secs(15))
        .json(&body)
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(anyhow!("graphql http {}", resp.status()));
    }
    let v: Value = resp.json().await?;
    let t = v
        .get("data")
        .and_then(|d| d.get("title"))
        .ok_or_else(|| anyhow!("no title"))?;
    let mut info = ImdbInfo {
        imdb_id: Some(imdb_id.to_string()),
        title: t.get("titleText").and_then(|x| x.get("text")).and_then(|x| x.as_str()).map(String::from),
        kind: t.get("titleType").and_then(|x| x.get("id")).and_then(|x| x.as_str()).map(String::from),
        year: t.get("releaseYear").and_then(|x| x.get("year")).and_then(|x| x.as_i64()).map(|y| y as i32),
        ..Default::default()
    };
    if let Some(rs) = t.get("ratingsSummary") {
        info.rating = rs.get("aggregateRating").and_then(|x| x.as_f64());
        info.votes = rs.get("voteCount").and_then(|x| x.as_u64());
    }
    info.image = t.get("primaryImage").and_then(|x| x.get("url")).and_then(|x| x.as_str()).map(String::from);
    Ok(info)
}
