"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import type { FeatureCollection, Point } from "geojson";
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
import { CATEGORY_COLORS, type MapContact } from "@/lib/contacts";

const LA = { longitude: -118.2437, latitude: 34.0522, zoom: 9.5 };

type Props = {
  contacts: MapContact[];
  selectedId: string | null;
  placing: boolean;
  onSelect: (id: string | null) => void;
  onPlace: (lat: number, lng: number) => void;
};

export default function MapView({ contacts, selectedId, placing, onSelect, onPlace }: Props) {
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

  // Keep the selected pin in the part of the map the contact sheet doesn't cover:
  // the top ~40% on phones (sheet is at the bottom), the left side on wider screens (sheet is on the right).
  useEffect(() => {
    const c = contacts.find((x) => x.id === selectedId);
    const map = mapRef.current;
    if (!c || c.map_lat == null || c.map_lng == null || !map) return;
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    const phone = w < 768;
    const point = map.project([c.map_lng, c.map_lat]);
    const visible = phone
      ? point.y > 70 && point.y < h * 0.4 && point.x > 0 && point.x < w
      : point.x > 0 && point.x < w - 400 && point.y > 70 && point.y < h;
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
    </Map>
  );
}
