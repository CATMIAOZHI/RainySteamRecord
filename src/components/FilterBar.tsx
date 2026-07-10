import { useTranslation } from "react-i18next";
import { useStore } from "../stores/app";

export default function FilterBar() {
  const { t } = useTranslation();
  const steamIds = useStore((state) => state.steamIds);
  const selectedSteamId = useStore((state) => state.selectedSteamId);
  const selectedMediaType = useStore((state) => state.selectedMediaType);
  const selectedGameId = useStore((state) => state.selectedGameId);
  const selectedDateFrom = useStore((state) => state.selectedDateFrom);
  const selectedDateTo = useStore((state) => state.selectedDateTo);
  const clips = useStore((state) => state.clips);
  const gameIds = useStore((state) => state.gameIds);
  const selectSteamId = useStore((state) => state.selectSteamId);
  const selectMediaType = useStore((state) => state.selectMediaType);
  const selectGameId = useStore((state) => state.selectGameId);
  const selectDateFrom = useStore((state) => state.selectDateFrom);
  const selectDateTo = useStore((state) => state.selectDateTo);

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

      <div className="flex h-10 items-center gap-1 rounded-lg border border-border bg-surface px-2">
        <span className="whitespace-nowrap text-xs text-text-muted">{t("filter.dateFrom")}</span>
        <input
          type="date"
          value={selectedDateFrom}
          max={selectedDateTo || undefined}
          onChange={(e) => selectDateFrom(e.target.value)}
          className="w-[122px] bg-transparent text-xs text-text outline-none"
        />
      </div>

      <div className="flex h-10 items-center gap-1 rounded-lg border border-border bg-surface px-2">
        <span className="whitespace-nowrap text-xs text-text-muted">{t("filter.dateTo")}</span>
        <input
          type="date"
          value={selectedDateTo}
          min={selectedDateFrom || undefined}
          onChange={(e) => selectDateTo(e.target.value)}
          className="w-[122px] bg-transparent text-xs text-text outline-none"
        />
      </div>

      {(selectedDateFrom || selectedDateTo) && (
        <button
          onClick={() => {
            selectDateFrom("");
            selectDateTo("");
          }}
          className="h-10 rounded-lg border border-border bg-surface px-3 text-xs text-text-muted hover:bg-surface-hover hover:text-text"
        >
          {t("filter.clearDate")}
        </button>
      )}
    </div>
  );
}
