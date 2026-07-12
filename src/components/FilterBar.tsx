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
  const search = useStore((state) => state.search);
  const sortField = useStore((state) => state.sortField);
  const sortDirection = useStore((state) => state.sortDirection);
  const clips = useStore((state) => state.clips);
  const gameIds = useStore((state) => state.gameIds);
  const selectSteamId = useStore((state) => state.selectSteamId);
  const selectMediaType = useStore((state) => state.selectMediaType);
  const selectGameId = useStore((state) => state.selectGameId);
  const selectDateFrom = useStore((state) => state.selectDateFrom);
  const selectDateTo = useStore((state) => state.selectDateTo);
  const setSearch = useStore((state) => state.setSearch);
  const setSort = useStore((state) => state.setSort);
  const clearFilters = useStore((state) => state.clearFilters);
  const loadClips = useStore((state) => state.loadClips);

  const gameIdsInClips = [...new Set(clips.map((c) => c.game_id))].sort();

  const isDateRangeInvalid = selectedDateFrom && selectedDateTo && selectedDateFrom > selectedDateTo;

  let activeFiltersCount = 0;
  if (search) activeFiltersCount += 1;
  if (selectedGameId) activeFiltersCount += 1;
  if (selectedMediaType !== "all") activeFiltersCount += 1;
  if (selectedDateFrom) activeFiltersCount += 1;
  if (selectedDateTo) activeFiltersCount += 1;

  return (
    <div className="flex flex-1 flex-wrap items-center gap-2 px-5 py-3">
      <div className="relative min-w-[220px] flex-1">
        <svg className="absolute left-3 top-3 text-text-muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></svg>
        <input
          id="library-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("library.searchPlaceholder")}
          aria-label={t("library.searchPlaceholder")}
          className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm text-text outline-none focus:border-accent"
        />
      </div>
      <select
        value={selectedSteamId}
        onChange={(e) => selectSteamId(e.target.value)}
        aria-label={t("filter.steamId")}
        className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none hover:border-accent focus:border-accent"
        style={{ minWidth: "140px" }}
      >
        {steamIds.map((id) => (
          <option key={id} value={id}>{id}</option>
        ))}
      </select>

      <select
        value={sortField}
        onChange={(event) => setSort(event.target.value as typeof sortField, sortDirection)}
        aria-label="Sort Field"
        className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none focus:border-accent"
      >
        <option value="datetime">{t("library.sortTime")}</option>
        <option value="duration">{t("library.sortDuration")}</option>
        <option value="game">{t("library.sortGame")}</option>
        <option value="size">{t("library.sortSize")}</option>
      </select>
      <button
        onClick={() => setSort(sortField)}
        className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-text hover:bg-surface-hover"
        title={t("library.sortDirection")}
        aria-label={t("library.sortDirection")}
      >
        {sortDirection === "asc" ? "↑" : "↓"}
      </button>

      <button
        onClick={() => void loadClips({ force: true })}
        className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-text hover:bg-surface-hover flex items-center gap-1.5"
        title={t("library.fullRescan")}
        aria-label={t("library.fullRescan")}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l.73-.73" />
        </svg>
        <span className="hidden md:inline text-xs">{t("library.fullRescan")}</span>
      </button>

      <select
        value={selectedGameId}
        onChange={(e) => selectGameId(e.target.value)}
        aria-label={t("filter.game")}
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
        aria-label={t("filter.mediaType")}
        className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-text outline-none hover:border-accent focus:border-accent"
        style={{ minWidth: "130px" }}
      >
        <option value="all">{t("filter.allClips")}</option>
        <option value="manual">{t("filter.manualClips")}</option>
        <option value="background">{t("filter.backgroundClips")}</option>
      </select>

      <div className={`flex h-10 items-center gap-1 rounded-lg border bg-surface px-2 ${isDateRangeInvalid ? "border-danger bg-danger/5" : "border-border"}`}>
        <span className="whitespace-nowrap text-xs text-text-muted">{t("filter.dateFrom")}</span>
        <input
          type="date"
          value={selectedDateFrom}
          max={selectedDateTo || undefined}
          onChange={(e) => selectDateFrom(e.target.value)}
          aria-label={t("filter.dateFrom")}
          className="w-[122px] bg-transparent text-xs text-text outline-none"
        />
      </div>

      <div className={`flex h-10 items-center gap-1 rounded-lg border bg-surface px-2 ${isDateRangeInvalid ? "border-danger bg-danger/5" : "border-border"}`}>
        <span className="whitespace-nowrap text-xs text-text-muted">{t("filter.dateTo")}</span>
        <input
          type="date"
          value={selectedDateTo}
          min={selectedDateFrom || undefined}
          onChange={(e) => selectDateTo(e.target.value)}
          aria-label={t("filter.dateTo")}
          className="w-[122px] bg-transparent text-xs text-text outline-none"
        />
      </div>

      {activeFiltersCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 h-10 text-xs text-accent">
          <span>{t("library.activeFilters", { count: activeFiltersCount })}</span>
          <button
            onClick={clearFilters}
            className="font-bold underline hover:text-accent-hover"
          >
            {t("library.clearAllFilters")}
          </button>
        </div>
      )}
    </div>
  );
}
