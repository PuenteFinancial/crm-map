"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import "./map-controls.css"; // after mapbox-gl.css so its overrides win
import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import type { GeoJSONSource } from "mapbox-gl";
import { useEffect, useMemo, useRef } from "react";
import Map, {
  GeolocateControl,
  Layer,
  NavigationControl,
  Source,
  type MapMouseEvent,
  type MapRef,
} from "react-map-gl/mapbox";
import { CATEGORY_COLORS, METERS_PER_MILE, type MapContact } from "@/lib/contacts";
import type { PlanResult } from "@/lib/route";
import type { NearbyAnchor } from "./nearby-sheet";

const LA = { longitude: -118.2437, latitude: 34.0522, zoom: 9.5 };

type Props = {
  contacts: MapContact[];
  selectedId: string | null;
  nearby: NearbyAnchor | null;
  route: PlanResult | null;
  /** The Plan/Nearby sheet is shrunk to a bar, so frame things using the whole screen. */
  sheetCollapsed: boolean;
  placing: boolean;
  onSelect: (id: string | null) => void;
  onPlace: (lat: number, lng: number) => void;
};

// Radius ring around a point, as a 64-sided polygon.
function circle(lat: number, lng: number, meters: number): Feature<Polygon> {
  const dLat = meters / 111320;
  const dLng = meters / (111320 * Math.cos((lat * Math.PI) / 180));
  const ring = Array.from({ length: 65 }, (_, i) => {
    const t = (i / 64) * 2 * Math.PI;
    return [lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)];
  });
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} };
}

export default function MapView({ contacts, selectedId, nearby, route, sheetCollapsed, placing, onSelect, onPlace }: Props) {
  const mapRef = useRef<MapRef>(null);

  const geojson = useMemo<FeatureCollection<Point>>(
    () => ({
      type: "FeatureCollection",
      features: contacts
        .filter((c) => c.map_lat != null && c.map_lng != null)
        .map((c) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [c.map_lng!, c.map_lat!] },
          properties: {
            id: c.id,
            name: c.name,
            category: c.category,
            priority: c.priority,
            visited: c.last_visit_at != null,
            meeting: c.next_meeting_at != null,
          },
        })),
    }),
    [contacts],
  );

  const routeStops = useMemo<FeatureCollection<Point>>(() => {
    let n = 0;
    return {
      type: "FeatureCollection",
      features: (route?.stops ?? [])
        .filter((s) => s.kind !== "end")
        .map((s) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [s.lng, s.lat] },
          properties: {
            kind: s.kind,
            label: s.kind === "start" ? "▶" : String(++n),
          },
        })),
    };
  }, [route]);

  // Space the sheet takes up: a slim bar when collapsed, most of the screen when open.
  function sheetPadding(w: number, h: number, openShare: number, panelWidth: number) {
    if (w >= 768) return { top: 80, bottom: 40, left: 40, right: sheetCollapsed ? 60 : panelWidth };
    return { top: 110, bottom: sheetCollapsed ? 100 : h * openShare + 10, left: 30, right: 30 };
  }

  // Frame the whole route above the plan sheet (phones) or left of it (wider screens).
  useEffect(() => {
    const map = mapRef.current;
    if (!route || !map || route.geometry.length === 0) return;
    const lngs = route.geometry.map((c) => c[0]);
    const lats = route.geometry.map((c) => c[1]);
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: sheetPadding(w, h, 0.75, 470), maxZoom: 14 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when the route or sheet changes
  }, [route, sheetCollapsed]);

  // Frame the whole Nearby radius above the sheet (phones) or left of it (wider screens).
  useEffect(() => {
    const map = mapRef.current;
    if (!nearby || !map) return;
    const dLat = (nearby.radiusMi * METERS_PER_MILE) / 111320;
    const dLng = dLat / Math.cos((nearby.lat * Math.PI) / 180);
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    map.fitBounds(
      [[nearby.lng - dLng, nearby.lat - dLat], [nearby.lng + dLng, nearby.lat + dLat]],
      { padding: sheetPadding(w, h, 0.55, 440) },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when the radius or sheet changes
  }, [nearby, sheetCollapsed]);

  // Keep the selected pin in the part of the map the contact sheet doesn't cover:
  // between the top bar + chips and the sheet on phones, left of the sheet on wider screens.
  useEffect(() => {
    const c = contacts.find((x) => x.id === selectedId);
    const map = mapRef.current;
    if (!c || c.map_lat == null || c.map_lng == null || !map) return;
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    const phone = w < 768;
    const point = map.project([c.map_lng, c.map_lat]);
    const visible = phone
      ? point.y > 140 && point.y < h * 0.4 && point.x > 0 && point.x < w
      : point.x > 0 && point.x < w - 400 && point.y > 140 && point.y < h;
    if (visible) return;
    map.easeTo({
      center: [c.map_lng, c.map_lat],
      zoom: Math.max(map.getZoom(), 11),
      offset: phone ? [0, -h * 0.28] : [-200, 0],
    });
    // Only re-run when the selection changes, not when data refreshes after an edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function handleClick(e: MapMouseEvent) {
    if (placing) return onPlace(e.lngLat.lat, e.lngLat.lng);

    const feature = e.features?.[0];
    if (!feature) return onSelect(null);

    if (feature.layer?.id === "clusters") {
      const source = mapRef.current?.getSource("contacts") as GeoJSONSource | undefined;
      const clusterId = feature.properties?.cluster_id as number;
      const [lng, lat] = (feature.geometry as Point).coordinates;
      source?.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (!err && zoom != null) mapRef.current?.easeTo({ center: [lng, lat], zoom });
      });
      return;
    }
    onSelect(String(feature.properties?.id));
  }

  return (
    <Map
      ref={mapRef}
      mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
      initialViewState={LA}
      mapStyle="mapbox://styles/mapbox/streets-v12"
      style={{ position: "absolute", inset: 0 }}
      interactiveLayerIds={placing ? [] : ["clusters", "contacts"]}
      cursor={placing ? "crosshair" : undefined}
      onClick={handleClick}
    >
      <GeolocateControl position="bottom-right" trackUserLocation showUserHeading />
      <NavigationControl position="bottom-right" showCompass={false} />

      {route && route.geometry.length > 0 && (
        <Source
          id="route"
          type="geojson"
          data={{ type: "Feature", geometry: { type: "LineString", coordinates: route.geometry }, properties: {} }}
        >
          <Layer id="route-casing" type="line" layout={{ "line-join": "round", "line-cap": "round" }} paint={{ "line-color": "#ffffff", "line-width": 7 }} />
          <Layer id="route-line" type="line" layout={{ "line-join": "round", "line-cap": "round" }} paint={{ "line-color": "#111827", "line-width": 4 }} />
        </Source>
      )}

      {nearby && (
        <Source id="nearby" type="geojson" data={circle(nearby.lat, nearby.lng, nearby.radiusMi * METERS_PER_MILE)}>
          <Layer id="nearby-fill" type="fill" paint={{ "fill-color": "#2563eb", "fill-opacity": 0.07 }} />
          <Layer id="nearby-line" type="line" paint={{ "line-color": "#2563eb", "line-width": 1.5, "line-dasharray": [2, 2] }} />
        </Source>
      )}
      {nearby && (
        <Source
          id="nearby-anchor"
          type="geojson"
          data={{ type: "Feature", geometry: { type: "Point", coordinates: [nearby.lng, nearby.lat] }, properties: {} }}
        >
          <Layer
            id="nearby-anchor"
            type="circle"
            paint={{ "circle-radius": 6, "circle-color": "#2563eb", "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 }}
          />
        </Source>
      )}

      <Source id="contacts" type="geojson" data={geojson} cluster clusterMaxZoom={13} clusterRadius={40}>
        <Layer
          id="clusters"
          type="circle"
          filter={["has", "point_count"]}
          paint={{
            "circle-color": "#111827",
            "circle-opacity": 0.85,
            "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 30, 24],
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          }}
        />
        <Layer
          id="cluster-count"
          type="symbol"
          filter={["has", "point_count"]}
          layout={{
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
            "text-size": 12,
          }}
          paint={{ "text-color": "#ffffff" }}
        />
        <Layer
          id="contacts"
          type="circle"
          filter={["!", ["has", "point_count"]]}
          paint={{
            "circle-color": [
              "match", ["get", "category"],
              "founder", CATEGORY_COLORS.founder,
              "financier", CATEGORY_COLORS.financier,
              "supply-chain", CATEGORY_COLORS["supply-chain"],
              CATEGORY_COLORS.other,
            ],
            "circle-radius": ["match", ["get", "priority"], "must-see", 10, "want-to-see", 7.5, 5.5],
            // Visited contacts get a dark ring; upcoming meetings a gold one.
            "circle-stroke-color": ["case", ["get", "meeting"], "#eab308", ["get", "visited"], "#111827", "#ffffff"],
            "circle-stroke-width": ["case", ["any", ["get", "meeting"], ["get", "visited"]], 3, 2],
          }}
        />
        <Layer
          id="contact-labels"
          type="symbol"
          filter={["!", ["has", "point_count"]]}
          minzoom={12}
          layout={{
            "text-field": ["get", "name"],
            "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
            "text-size": 12,
            "text-offset": [0, 1.3],
            "text-anchor": "top",
          }}
          paint={{ "text-color": "#111827", "text-halo-color": "#ffffff", "text-halo-width": 1.5 }}
        />
        <Layer
          id="selected"
          type="circle"
          filter={["==", ["get", "id"], selectedId ?? ""]}
          paint={{
            "circle-radius": 16,
            "circle-color": "transparent",
            "circle-stroke-color": "#111827",
            "circle-stroke-width": 3,
          }}
        />
      </Source>

      {route && (
        <Source id="route-stops" type="geojson" data={routeStops}>
          <Layer
            id="route-stops"
            type="circle"
            paint={{
              "circle-radius": 11,
              "circle-color": ["match", ["get", "kind"], "meeting", "#facc15", "start", "#2563eb", "#111827"],
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 2,
            }}
          />
          <Layer
            id="route-stop-labels"
            type="symbol"
            layout={{
              "text-field": ["get", "label"],
              "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
              "text-size": 12,
              "text-allow-overlap": true,
            }}
            paint={{ "text-color": ["match", ["get", "kind"], "meeting", "#111827", "#ffffff"] }}
          />
        </Source>
      )}
    </Map>
  );
}
