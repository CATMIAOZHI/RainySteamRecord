import { useTranslation } from "react-i18next";
import { useStore } from "../stores/app";

export default function FilterBar() {
  const { t } = useTranslation();
  const {
    steamIds,
    selectedSteamId,
    selectedMediaType,
    selectedGameId,
    clips,
    gameIds,
    selectSteamId,
    selectMediaType,
    selectGameId,
  } = useStore();

  const gameIdsInClips = [...new Set(clips.map((c) => c.game_id))].sort();

  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-3">
      <select
        value={selectedSteamId}
        onChange={(e) => selectSteamId(e.target.value)}
        className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none hover:border-accent focus:border-accent"
        style={{ minWidth: "140px" }}
      >
        {steamIds.map((id) => (
          <option key={id} value={id}>{id}</option>
        ))}
      </select>

      <select
        value={selectedGameId}
        onChange={(e) => selectGameId(e.target.value)}
        className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none hover:border-accent focus:border-accent"
        style={{ minWidth: "160px" }}
      >
        <option value="">{t("common.allGames")}</option>
        {gameIdsInClips.map((id) => (
          <option key={id} value={id}>
            {gameIds[id] || id}
          </option>
        ))}
      </select>

      <select
        value={selectedMediaType}
        onChange={(e) => selectMediaType(e.target.value)}
        className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none hover:border-accent focus:border-accent"
        style={{ minWidth: "130px" }}
      >
        <option value="all">{t("filter.allClips")}</option>
        <option value="manual">{t("filter.manualClips")}</option>
        <option value="background">{t("filter.backgroundClips")}</option>
      </select>
    </div>
  );
}