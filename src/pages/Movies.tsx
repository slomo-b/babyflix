import { CatalogPage } from "./CatalogPage";
import { useT } from "../lib/i18n";

export default function Movies() {
  const t = useT();
  return <CatalogPage kind="movie" title={t("movies.title")} subtitle={t("movies.subtitle")} />;
}
