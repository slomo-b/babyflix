import { Star } from "lucide-react";
import { fmtVotes } from "../lib/format";
import { useT } from "../lib/i18n";

export function RatingBadge({
  value,
  votes,
  source = "imdb",
}: {
  value: number;
  votes?: number | null;
  source?: "imdb" | "panel";
}) {
  const t = useT();
  const v = value.toFixed(1);
  const votesLabel = source === "imdb" ? fmtVotes(votes) : null;
  return (
    <span
      className="rating-badge"
      title={source === "imdb" ? t("rating.imdb") : t("rating.panel")}
    >
      <Star size={11} fill="#f5c518" stroke="#f5c518" />
      {v}
      {votesLabel ? <span className="opacity-60 font-medium">({votesLabel})</span> : null}
    </span>
  );
}
