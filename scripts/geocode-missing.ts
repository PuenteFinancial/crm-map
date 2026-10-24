// Geocode contacts/companies saved with an address but no pin (e.g. before the Mapbox token was set).
//   npm run geocode:missing
import { geocodingEnabled } from "../src/lib/geocode";
import { backfillGeocodes } from "../src/lib/ingest";
import { db } from "./db";

if (!geocodingEnabled()) {
  console.error("NEXT_PUBLIC_MAPBOX_TOKEN is not set in .env.local");
  process.exit(1);
}

backfillGeocodes(db)
  .then((s) => {
    console.log(`Geocoded ${s.companies} companies and ${s.contacts} contacts.`);
    if (s.unresolved.length) console.log(`No match (fix by hand):\n  ${s.unresolved.join("\n  ")}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
