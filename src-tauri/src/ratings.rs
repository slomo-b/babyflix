//! Keyless IMDb ratings from the official IMDb datasets (title.ratings.tsv.gz).
//! Downloaded once, parsed into a compact sorted index for binary search.
use anyhow::{Context, Result};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::sync::Arc;

const RATINGS_URL: &str = "https://datasets.imdbws.com/title.ratings.tsv.gz";

#[derive(Clone, Copy)]
pub struct RatingRow {
    pub id: u32,
    pub rating: f32,
    pub votes: u32,
}

#[derive(Clone, Default)]
pub struct RatingStore {
    pub rows: Option<Arc<Vec<RatingRow>>>,
}

pub fn tt_to_u32(imdb_id: &str) -> Option<u32> {
    imdb_id.strip_prefix("tt").and_then(|s| s.parse::<u32>().ok())
}

impl RatingStore {
    pub fn lookup(&self, imdb_id: &str) -> Option<(f32, u32)> {
        let key = tt_to_u32(imdb_id)?;
        let rows = self.rows.as_ref()?;
        match rows.binary_search_by_key(&key, |r| r.id) {
            Ok(i) => Some((rows[i].rating, rows[i].votes)),
            Err(_) => None,
        }
    }

    pub fn loaded(&self) -> bool {
        self.rows.is_some()
    }

    /// Download (if needed) and parse. Blocking work is offloaded by the caller.
    pub async fn ensure(&mut self, client: &reqwest::Client, cache_dir: &Path) -> Result<()> {
        if self.rows.is_some() {
            return Ok(());
        }
        let gz = cache_dir.join("title.ratings.tsv.gz");
        let bin = cache_dir.join("ratings.bin");
        if !bin.exists() {
            if !gz.exists() {
                download(client, RATINGS_URL, &gz).await?;
            }
            let gz2 = gz.clone();
            let bin2 = bin.clone();
            tokio::task::spawn_blocking(move || build_binary(&gz2, &bin2))
                .await
                .context("rating index task")??;
        }
        let bin2 = bin.clone();
        let rows = tokio::task::spawn_blocking(move || load_binary(&bin2))
            .await
            .context("rating load task")??;
        self.rows = Some(Arc::new(rows));
        Ok(())
    }
}

async fn download(client: &reqwest::Client, url: &str, dest: &Path) -> Result<()> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await.ok();
    }
    let tmp = dest.with_extension("part");
    let resp = client.get(url).send().await?.error_for_status()?;
    let mut file = tokio::fs::File::create(&tmp).await?;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        file.write_all(&chunk).await?;
    }
    file.flush().await?;
    drop(file);
    tokio::fs::rename(&tmp, dest).await?;
    Ok(())
}

fn parse_gz(gz: &Path) -> Result<Vec<RatingRow>> {
    let file = std::fs::File::open(gz)?;
    let reader = BufReader::with_capacity(1 << 20, flate2::read::GzDecoder::new(file));
    let mut rows: Vec<RatingRow> = Vec::with_capacity(1_600_000);
    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        let mut parts = line.split('\t');
        let (Some(tt), Some(rating), Some(votes)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        let Some(id) = tt_to_u32(tt) else { continue };
        let Ok(r) = rating.parse::<f32>() else { continue };
        let Ok(v) = votes.parse::<u32>() else { continue };
        rows.push(RatingRow { id, rating: r, votes: v });
    }
    Ok(rows)
}

/// Compact binary format: repeated [u32 id][f32 rating][u32 votes] (little endian).
fn build_binary(gz: &Path, bin: &Path) -> Result<()> {
    let mut rows = parse_gz(gz)?;
    rows.sort_unstable_by_key(|r| r.id);
    let mut buf = Vec::with_capacity(rows.len() * 12);
    for r in &rows {
        buf.extend_from_slice(&r.id.to_le_bytes());
        buf.extend_from_slice(&r.rating.to_le_bytes());
        buf.extend_from_slice(&r.votes.to_le_bytes());
    }
    std::fs::write(bin, buf)?;
    Ok(())
}

fn load_binary(bin: &Path) -> Result<Vec<RatingRow>> {
    let data = std::fs::read(bin)?;
    let n = data.len() / 12;
    let mut rows = Vec::with_capacity(n);
    for i in 0..n {
        let o = i * 12;
        let id = u32::from_le_bytes([data[o], data[o + 1], data[o + 2], data[o + 3]]);
        let rating = f32::from_le_bytes([data[o + 4], data[o + 5], data[o + 6], data[o + 7]]);
        let votes = u32::from_le_bytes([data[o + 8], data[o + 9], data[o + 10], data[o + 11]]);
        rows.push(RatingRow { id, rating, votes });
    }
    Ok(rows)
}
