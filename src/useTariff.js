// The water rate and minimum bill, read from the server (GET /api/tariff).
// The server owns these values (server/src/utils/tariff.js); the app displays
// them and, for officers, changes them through the Settings page.
import { useCallback, useEffect, useState } from "react";
import { fetchTariff } from "./api";

export function useTariff() {
  const [tariff, setTariff] = useState(null);
  const reload = useCallback(() => fetchTariff().then(setTariff).catch(() => setTariff(null)), []);
  useEffect(() => {
    reload();
  }, [reload]);
  return { tariff, reload };
}
