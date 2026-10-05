import { CatalogPage } from "./CatalogPage";
import { useT } from "../lib/i18n";

export default function Series() {
  const t = useT();
  return <CatalogPage kind="series" title={t("series.title")} subtitle={t("series.subtitle")} />;
}
