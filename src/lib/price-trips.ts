import type { PricedTrip, TripMention } from "./types.js";

const STAY22_ACCOMMODATIONS_URL = "https://api.stay22.com/v2/accommodations";
const DEFAULT_SUGGESTED_NIGHTS = 3;
const DEFAULT_PARTICIPANT_COUNT = 2;

interface Stay22Supplier {
  link?: string;
  price?: {
    total?: number;
  };
}

interface Stay22Accommodation {
  name?: string;
  url?: string;
  suppliers?: Record<string, Stay22Supplier>;
}

interface Stay22Response {
  results?: Stay22Accommodation[];
}

interface HotelCandidate {
  hotelName: string;
  total: number;
  bookingUrl: string;
}

const ROMANTIC_PROPERTY_PATTERN =
  /\b(love|romance|romantic|couple|couples|honeymoon|lover|lovers|adults?\s*only|motel)\b/i;

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getDefaultStayDates() {
  const checkin = new Date();
  checkin.setDate(checkin.getDate() + 21);

  const checkout = new Date(checkin);
  checkout.setDate(checkout.getDate() + DEFAULT_SUGGESTED_NIGHTS);

  return {
    checkin: formatDate(checkin),
    checkout: formatDate(checkout),
  };
}

function getParticipantCount(trip: TripMention) {
  return trip.participants.length > 0 ? trip.participants.length : DEFAULT_PARTICIPANT_COUNT;
}

function getBestSupplier(accommodation: Stay22Accommodation) {
  const suppliers = Object.values(accommodation.suppliers ?? {}).filter(
    (supplier) => typeof supplier.price?.total === "number" && supplier.price.total > 0,
  );

  return suppliers.sort((a, b) => (a.price?.total ?? 0) - (b.price?.total ?? 0))[0];
}

function toHotelCandidates(results: Stay22Accommodation[]) {
  return results
    .map((accommodation): HotelCandidate | null => {
      const supplier = getBestSupplier(accommodation);
      const total = supplier?.price?.total;
      const bookingUrl = supplier?.link ?? accommodation.url;

      if (!accommodation.name || !total || !bookingUrl) {
        return null;
      }

      return {
        hotelName: accommodation.name,
        total,
        bookingUrl,
      };
    })
    .filter((candidate): candidate is HotelCandidate => candidate !== null)
    .sort((a, b) => a.total - b.total);
}

function pickMidRangeHotel(candidates: HotelCandidate[]) {
  if (candidates.length === 0) {
    return null;
  }

  const neutralCandidates = candidates.filter(
    (candidate) => !ROMANTIC_PROPERTY_PATTERN.test(candidate.hotelName),
  );
  const candidatePool = neutralCandidates.length > 0 ? neutralCandidates : candidates;

  if (neutralCandidates.length === 0) {
    console.warn("No neutral hotel candidates found; falling back to unfiltered results.");
  }

  return candidatePool[Math.floor(candidatePool.length / 2)];
}

async function searchStay22(destination: string, participantCount: number) {
  const apiKey = requireEnv("STAY22_API_KEY");
  const { checkin, checkout } = getDefaultStayDates();
  const params = new URLSearchParams({
    address: destination,
    checkin,
    checkout,
    adults: String(Math.max(participantCount, DEFAULT_PARTICIPANT_COUNT)),
    rooms: "1",
    currency: "USD",
    pageSize: "20",
    page: "1",
  });

  const response = await fetch(`${STAY22_ACCOMMODATIONS_URL}?${params.toString()}`, {
    headers: {
      "X-API-KEY": apiKey,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Stay22 search failed for ${destination}: ${response.status} ${response.statusText} ${errorBody}`,
    );
  }

  return (await response.json()) as Stay22Response;
}

async function priceTrip(trip: TripMention): Promise<PricedTrip | null> {
  const participantCount = getParticipantCount(trip);
  const response = await searchStay22(trip.destination, participantCount);
  const candidates = toHotelCandidates(response.results ?? []);
  const hotel = pickMidRangeHotel(candidates);

  if (!hotel) {
    console.warn(`No Stay22 bookable hotel results for ${trip.destination}.`);
    return null;
  }

  const nightlyRate = hotel.total / DEFAULT_SUGGESTED_NIGHTS;

  return {
    ...trip,
    nightlyRate: Math.round(nightlyRate),
    suggestedNights: DEFAULT_SUGGESTED_NIGHTS,
    totalCostPerPerson: Math.round(hotel.total / participantCount),
    hotelName: hotel.hotelName,
    bookingUrl: hotel.bookingUrl,
  };
}

export async function priceTrips(trips: TripMention[]): Promise<PricedTrip[]> {
  const pricedTrips: PricedTrip[] = [];

  for (const trip of trips) {
    try {
      const pricedTrip = await priceTrip(trip);

      if (pricedTrip) {
        pricedTrips.push(pricedTrip);
      }
    } catch (error) {
      console.warn(`Skipping Stay22 pricing for ${trip.destination}:`, error);
    }
  }

  return pricedTrips;
}
