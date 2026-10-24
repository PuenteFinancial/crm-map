"use client";

import { useEffect, useState, useTransition } from "react";
import type { PlanResult, PlanSettings } from "@/lib/route";
import { nowWallTime } from "@/lib/time";
import { getPlanData, optimizePlan, savePlan, type Place } from "./plan-actions";

const DEFAULTS = { dayStart: "09:00", dayEnd: "18:00", dwellMin: 20, returnToStart: true };

function defaultSettings(places: Place[]): PlanSettings | null {
  const home = places.find((p) => p.is_default) ?? places[0];
  return home ? { ...DEFAULTS, start: { name: home.name, lat: home.lat, lng: home.lng } } : null;
}

// One day's plan, shared by the Plan sheet, the contact sheet ("+ Plan") and Nearby.
// Every change is saved so Joshua and Colton see the same plan.
export function useDayPlan() {
  const [date, setDate] = useState(() => nowWallTime().slice(0, 10));
  const [picks, setPicks] = useState<string[]>([]);
  const [settings, setSettings] = useState<PlanSettings | null>(null);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [optimizing, startOptimizing] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getPlanData(date)
      .then(({ plan, places }) => {
        if (cancelled) return;
        setPlaces(places);
        setPicks(plan.picks);
        setSettings(plan.settings ?? defaultSettings(places));
        setResult(plan.result);
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [date]);

  function persist(nextPicks: string[], nextSettings: PlanSettings | null) {
    setResult(null);
    savePlan(date, nextPicks, nextSettings).catch((e) => setError((e as Error).message));
  }

  return {
    date,
    setDate,
    picks,
    settings,
    result,
    places,
    error,
    optimizing,
    has: (id: string) => picks.includes(id),
    toggle(id: string) {
      const next = picks.includes(id) ? picks.filter((p) => p !== id) : [...picks, id];
      setPicks(next);
      persist(next, settings);
    },
    /** Add (or remove) several contacts at once, keeping the existing order. */
    setMany(ids: string[], on: boolean) {
      const next = on ? [...picks, ...ids.filter((id) => !picks.includes(id))] : picks.filter((p) => !ids.includes(p));
      setPicks(next);
      persist(next, settings);
    },
    updateSettings(patch: Partial<PlanSettings>) {
      const next = { ...DEFAULTS, ...settings, ...patch } as PlanSettings;
      setSettings(next);
      persist(picks, next);
    },
    /** Back to editing stops; the saved route stays until something changes. */
    clearResult() {
      setResult(null);
    },
    addPlaceLocally(place: Place) {
      setPlaces((ps) => [...ps.map((p) => (place.is_default ? { ...p, is_default: false } : p)), place]);
    },
    optimize() {
      if (!settings) return;
      setError(null);
      startOptimizing(async () => {
        try {
          setResult(await optimizePlan(date, picks, settings));
        } catch (e) {
          setError((e as Error).message);
        }
      });
    },
  };
}

export type DayPlanState = ReturnType<typeof useDayPlan>;
