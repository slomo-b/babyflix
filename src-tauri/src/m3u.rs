//! M3U / M3U Plus playlist parsing (alternative to the Xtream JSON API).
use anyhow::Result;
use std::collections::HashMap;
use std::time::Duration;

use crate::xtream::{Category, MediaItem, UA};

pub struct Parsed {
    pub live: Vec<MediaItem>,
    pub movie: Vec<MediaItem>,
    pub series: Vec<MediaItem>,
}

pub async fn fetch(client: &reqwest::Client, url: &str, ua: &str) -> Result<String> {
    let resp = client
        .get(url)
        .header("User-Agent", ua)
        .header("Accept", "*/*")
        .timeout(Duration::from_secs(120))
        .send()
        .await?
        .error_for_status()?;
    Ok(resp.text().await?)
}

fn parse_attrs(line: &str) -> HashMap<String, String> {
    let mut m = HashMap::new();
    let mut rest = line;
    while let Some(eq) = rest.find("=\"") {
        let key_start = rest[..eq]
            .rfind(|c: char| c == ' ' || c == ':')
            .map(|p| p + 1)
            .unwrap_or(0);
        let key = rest[key_start..eq].trim().to_string();
        let after = &rest[eq + 2..];
        match after.find('"') {
            Some(endq) => {
                if !key.is_empty() {
                    m.insert(key, after[..endq].to_string());
                }
                rest = &after[endq + 1..];
            }
            None => break,
        }
    }
    m
}

fn path_lower(url: &str) -> String {
    url.split(['?', '#']).next().unwrap_or(url).to_lowercase()
}

fn classify(url: &str) -> &'static str {
    let p = path_lower(url);
    if p.contains("/live/") {
        "live"
    } else if p.contains("/movie/") {
        "movie"
    } else if p.contains("/series/") {
        "series"
    } else if p.ends_with(".m3u8") || p.ends_with(".ts") {
        "live"
    } else {
        "movie"
    }
}

fn ext_of(url: &str) -> Option<String> {
    let p = path_lower(url);
    let name = p.rsplit('/').next().unwrap_or(&p);
    name.rsplit_once('.').map(|(_, e)| e.to_string()).filter(|e| {
        !e.is_empty() && e.len() <= 5 && e.chars().all(|c| c.is_ascii_alphanumeric())
    })
}

pub fn stable_id(url: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in url.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("m3u{h:016x}")
}

pub fn parse(text: &str) -> Parsed {
    let mut live: Vec<MediaItem> = Vec::new();
    let mut movie: Vec<MediaItem> = Vec::new();
    let mut series: Vec<MediaItem> = Vec::new();

    let mut pending: Option<(HashMap<String, String>, String)> = None;
    let mut pending_group: Option<String> = None;

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with("#EXTINF") {
            let attrs = parse_attrs(line);
            let name = line.rsplit(',').next().unwrap_or("").trim().to_string();
            pending_group = attrs.get("group-title").cloned().filter(|s| !s.is_empty());
            pending = Some((attrs, name));
            continue;
        }
        if line.starts_with("#EXTGRP:") {
            pending_group = Some(line["#EXTGRP:".len()..].trim().to_string());
            continue;
        }
        if line.starts_with('#') {
            continue;
        }
        // A media URL line.
        let url = line.to_string();
        let (attrs, name) = pending.take().unwrap_or_default();
        let kind = classify(&url);
        let group = attrs
            .get("group-title")
            .cloned()
            .filter(|s| !s.is_empty())
            .or_else(|| pending_group.clone());
        let item = MediaItem {
            id: stable_id(&url),
            kind: kind.to_string(),
            name: if name.is_empty() { url.clone() } else { name },
            cover: attrs.get("tvg-logo").cloned().filter(|s| !s.is_empty()),
            category_id: group,
            extension: ext_of(&url),
            added: None,
            rating: None,
            epg_channel_id: attrs.get("tvg-id").cloned().filter(|s| !s.is_empty()),
            tv_archive: false,
            url: Some(url),
        };
        match kind {
            "live" => live.push(item),
            "series" => series.push(item),
            _ => movie.push(item),
        }
    }

    live.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    movie.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    series.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Parsed { live, movie, series }
}

/// Derive categories from a catalog (M3U group-titles live in `category_id`).
pub fn categories_from(items: &[MediaItem]) -> Vec<Category> {
    let mut seen: Vec<String> = Vec::new();
    for it in items {
        if let Some(c) = &it.category_id {
            if !c.is_empty() && !seen.iter().any(|x| x == c) {
                seen.push(c.clone());
            }
        }
    }
    seen.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    seen.into_iter().map(|name| Category { id: name.clone(), name }).collect()
}

/// Try to upgrade a raw MPEG-TS live URL to its HLS (.m3u8) sibling, so browsers can play it.
pub async fn hls_candidate(client: &reqwest::Client, url: &str, kind: &str, ua: &str) -> Option<String> {
    if kind != "live" {
        return None;
    }
    let (path, query) = match url.split_once('?') {
        Some((p, q)) => (p.to_string(), Some(q.to_string())),
        None => (url.to_string(), None),
    };
    if !path.to_lowercase().ends_with(".ts") {
        return None;
    }
    let cand_path = format!("{}.m3u8", &path[..path.len() - 3]);
    let cand = match query {
        Some(q) => format!("{cand_path}?{q}"),
        None => cand_path,
    };
    let resp = client
        .get(&cand)
        .header("User-Agent", ua)
        .timeout(Duration::from_secs(6))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let ct = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let is_hls = ct.contains("mpegurl")
        || resp
            .url()
            .path()
            .to_lowercase()
            .ends_with(".m3u8");
    if is_hls {
        Some(cand)
    } else {
        None
    }
}

#[allow(dead_code)]
pub const DEFAULT_UA: &str = UA;
