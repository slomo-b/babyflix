//! Adult / pornographic category filter.
//!
//! The Xtream API has no official "adult" flag, so this matches **category**
//! names against keywords. Single titles are deliberately never matched: doing
//! so would also hide legitimate movies such as "Sex and the City".
//!
//! Tune `SUBSTRINGS` / `TOKENS` to match the categories of your own panel.

/// Distinctive substrings - a hit anywhere in the name marks it as adult.
const SUBSTRINGS: &[&str] = &[
    "adult",
    "porn",
    "xxx",
    "erotic",
    "erotik",
    "erotica",
    "hentai",
    "onlyfans",
    "hardcore",
    "fetish",
    "swinger",
    "redlight",
    "x-rated",
    "xrated",
    "18+",
    "18plus",
];

/// Short or ambiguous words that only count as a whole word, never as part of a
/// longer one - this way "Sussex" does not match the keyword "sex".
const TOKENS: &[&str] = &["sex", "sexy", "mature", "18"];

/// `true` when the category name looks like adult content.
pub fn is_adult_category(name: &str) -> bool {
    let n = name.to_lowercase();
    if SUBSTRINGS.iter().any(|k| n.contains(k)) {
        return true;
    }
    n.split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .any(|t| TOKENS.contains(&t))
}

#[cfg(test)]
mod tests {
    use super::is_adult_category;

    #[test]
    fn flags_adult_categories() {
        for name in [
            "ADULT",
            "Adult 18+",
            "XXX",
            "Erotik",
            "Porno HD",
            "Hentai",
            "OnlyFans",
            "Mature",
            "18+",
            "Sex",
        ] {
            assert!(is_adult_category(name), "{name:?} should be adult");
        }
    }

    #[test]
    fn keeps_regular_categories() {
        for name in [
            "Movies",
            "Serien",
            "Live TV",
            "Dokumentationen",
            "Kids",
            "Anime",
            "Sport",
            "Sussex News",
        ] {
            assert!(!is_adult_category(name), "{name:?} should not be adult");
        }
    }
}
