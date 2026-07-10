import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";

export default function App() {
  const { t } = useTranslation();
  const [greeting, setGreeting] = useState<string>("...");
  const [events, setEvents] = useState<string[]>([]);

  useEffect(() => {
    invoke<string>("ping", { name: "RainySteamRecord" })
      .then(setGreeting)
      .catch((e) => setGreeting(`Error: ${e}`));

    const unlisten = listen<string>("sidecar-event", (event) => {
      setEvents((prev) => [...prev, event.payload].slice(-10));
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold text-accent">
        {t("app.title")}
      </h1>
      <p className="text-text-muted">{t("app.subtitle")}</p>
      <div className="rounded-lg border border-border bg-surface px-6 py-4">
        <p className="text-lg">{greeting}</p>
      </div>
      {events.length > 0 && (
        <div className="w-full max-w-md rounded-lg border border-border bg-surface p-4">
          <p className="mb-2 text-sm text-text-muted">
            {t("app.sidecarEvents")}
          </p>
          <ul className="space-y-1 text-sm">
            {events.map((e, i) => (
              <li key={i} className="text-text-muted">
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}