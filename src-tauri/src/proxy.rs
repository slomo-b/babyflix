//! Streaming proxy: forwards Range requests, rewrites HLS playlists so every
//! segment/variant is fetched through us, and proxies images. Keeps credentials
//! and cross-origin issues entirely inside the local backend.
use anyhow::Result;
use axum::body::Body;
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::Response;
use futures_util::StreamExt;
use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};

use crate::xtream::UA;

pub const PORT: u16 = 4523;

pub fn origin() -> String {
    format!("http://127.0.0.1:{PORT}")
}

pub fn proxify(origin: &str, url: &str) -> String {
    format!("{origin}/api/proxy?u={}", utf8_percent_encode(url, NON_ALPHANUMERIC))
}

pub fn decode_url(s: &str) -> String {
    percent_decode_str(s).decode_utf8_lossy().to_string()
}

fn is_m3u8(url: &str, ct: Option<&str>) -> bool {
    if let Some(ct) = ct {
        let ct = ct.to_lowercase();
        if ct.contains("mpegurl") {
            return true;
        }
    }
    url.split('?').next().unwrap_or(url).to_lowercase().ends_with(".m3u8")
}

fn resolve(base: Option<&reqwest::Url>, uri: &str) -> String {
    let uri = uri.trim();
    if uri.starts_with("http://") || uri.starts_with("https://") {
        return uri.to_string();
    }
    if let Some(b) = base {
        if let Ok(j) = b.join(uri) {
            return j.to_string();
        }
    }
    uri.to_string()
}

/// Rewrite every URI inside an HLS playlist to route through our proxy.
fn rewrite_m3u8(origin: &str, base: &str, text: &str) -> String {
    let base_url = reqwest::Url::parse(base).ok();
    let mut out = String::with_capacity(text.len() * 2);
    for line in text.lines() {
        let t = line.trim();
        if t.is_empty() {
            out.push('\n');
            continue;
        }
        if t.starts_with('#') {
            if let Some(pos) = t.find("URI=\"") {
                let after = &t[pos + 5..];
                if let Some(end) = after.find('"') {
                    let uri = &after[..end];
                    let abs = resolve(base_url.as_ref(), uri);
                    out.push_str(&t[..pos + 5]);
                    out.push_str(&proxify(origin, &abs));
                    out.push_str(&after[end..]);
                    out.push('\n');
                    continue;
                }
            }
            out.push_str(t);
            out.push('\n');
        } else {
            let abs = resolve(base_url.as_ref(), t);
            out.push_str(&proxify(origin, &abs));
            out.push('\n');
        }
    }
    out
}

fn passthrough_builder(status: StatusCode) -> axum::http::response::Builder {
    Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "*")
        .header(header::CACHE_CONTROL, "no-cache")
}

pub async fn proxy(
    client: &reqwest::Client,
    origin: &str,
    url: &str,
    range: Option<String>,
    ua: Option<&str>,
) -> Result<Response> {
    let mut req = client
        .get(url)
        .header("User-Agent", ua.unwrap_or(UA))
        .header("Accept", "*/*");
    if let Some(r) = range {
        if !r.is_empty() {
            req = req.header("Range", r);
        }
    }
    let resp = req.send().await?;
    let status = resp.status();
    let headers = resp.headers().clone();
    let ct = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    if is_m3u8(url, ct.as_deref()) {
        let text = resp.text().await?;
        let rewritten = rewrite_m3u8(origin, url, &text);
        return Ok(Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/vnd.apple.mpegurl")
            .header(header::CACHE_CONTROL, "no-store")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(Body::from(rewritten))?);
    }

    let code = StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK);
    let mut builder = passthrough_builder(code);
    for (k, v) in headers.iter() {
        if matches!(
            k.as_str(),
            "content-type"
                | "content-length"
                | "content-range"
                | "accept-ranges"
                | "content-disposition"
                | "last-modified"
                | "etag"
        ) {
            if let Ok(hv) = HeaderValue::from_bytes(v.as_bytes()) {
                builder = builder.header(k, hv);
            }
        }
    }
    if !headers.contains_key(header::ACCEPT_RANGES) {
        builder = builder.header(header::ACCEPT_RANGES, "bytes");
    }
    let stream = resp
        .bytes_stream()
        .map(|r| r.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e)));
    Ok(builder.body(Body::from_stream(stream))?)
}

pub async fn proxy_image(client: &reqwest::Client, url: &str, ua: Option<&str>) -> Result<Response> {
    let resp = client
        .get(url)
        .header("User-Agent", ua.unwrap_or(UA))
        .header("Accept", "image/*,*/*")
        .send()
        .await?;
    let status = resp.status();
    let ct = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    let bytes = resp.bytes().await?;
    Ok(Response::builder()
        .status(StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK))
        .header(header::CONTENT_TYPE, ct)
        .header(header::CACHE_CONTROL, "public, max-age=86400")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Body::from(bytes))?)
}
