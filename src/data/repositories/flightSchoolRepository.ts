import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/id";
import type { FlightSchool, FlightSchoolTrainingTrack, Id } from "@/domain/types";
import { toNullableNumber, toNullableText, toText, type SqlDatabase } from "../db";

interface Row {
  id: string;
  name: unknown;
  hourly_cost_cents: unknown;
  aircraft_description: unknown;
  training_track: unknown;
  availability_description: unknown;
  discovery_flight_reflection: unknown;
  created_at: unknown;
  updated_at: unknown;
}

const ALLOWED_TRACKS: ReadonlySet<string> = new Set<FlightSchoolTrainingTrack>([
  "Part 61",
  "Part 141",
  "not sure",
]);

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER; // 9007199254740991

const map = (row: Row): FlightSchool => {
  const rawTrack = toNullableText(row.training_track);
  const trainingTrack =
    rawTrack && ALLOWED_TRACKS.has(rawTrack)
      ? (rawTrack as FlightSchoolTrainingTrack)
      : null;

  return {
    id: row.id,
    name: toText(row.name),
    hourlyCostCents: toNullableNumber(row.hourly_cost_cents),
    aircraftDescription: toNullableText(row.aircraft_description),
    trainingTrack,
    availabilityDescription: toNullableText(row.availability_description),
    discoveryFlightReflection: toNullableText(row.discovery_flight_reflection),
    createdAt: toText(row.created_at),
    updatedAt: toText(row.updated_at),
  };
};

export interface NewFlightSchool {
  name: string;
  hourlyCostCents?: number | null;
  aircraftDescription?: string | null;
  trainingTrack?: FlightSchoolTrainingTrack | null;
  availabilityDescription?: string | null;
  discoveryFlightReflection?: string | null;
}

export interface UpdateFlightSchool {
  name?: string;
  hourlyCostCents?: number | null;
  aircraftDescription?: string | null;
  trainingTrack?: FlightSchoolTrainingTrack | null;
  availabilityDescription?: string | null;
  discoveryFlightReflection?: string | null;
}

function validateName(rawName: unknown): string {
  if (typeof rawName !== "string") {
    throw new Error("Flight school name must be a string.");
  }
  const trimmed = rawName.trim();
  if (trimmed.length < 1 || trimmed.length > 200) {
    throw new Error("Flight school name must be between 1 and 200 characters.");
  }
  return trimmed;
}

function validateCost(rawCost: unknown): number | null {
  if (rawCost === null || rawCost === undefined) {
    return null;
  }
  if (typeof rawCost !== "number" || !Number.isSafeInteger(rawCost) || rawCost < 0 || rawCost > MAX_SAFE_INTEGER) {
    throw new Error("Hourly cost in cents must be a non-negative safe integer.");
  }
  return rawCost;
}

function validateText(rawText: unknown, maxLength: number, fieldName: string): string | null {
  if (rawText === null || rawText === undefined) {
    return null;
  }
  if (typeof rawText !== "string") {
    throw new Error(`${fieldName} must be a string.`);
  }
  if (rawText.length > maxLength) {
    throw new Error(`${fieldName} exceeds maximum length of ${maxLength} characters.`);
  }
  return rawText;
}

function validateTrack(rawTrack: unknown): FlightSchoolTrainingTrack | null {
  if (rawTrack === null || rawTrack === undefined) {
    return null;
  }
  if (typeof rawTrack !== "string" || !ALLOWED_TRACKS.has(rawTrack)) {
    throw new Error("Training track must be 'Part 61', 'Part 141', 'not sure', or null.");
  }
  return rawTrack as FlightSchoolTrainingTrack;
}

export function flightSchoolRepository(db: SqlDatabase) {
  return {
    async list(): Promise<FlightSchool[]> {
      const rows = await db.select<Row>(
        "SELECT * FROM flight_schools ORDER BY name COLLATE NOCASE ASC, id ASC",
      );
      return rows.map(map);
    },

    async get(id: Id): Promise<FlightSchool | null> {
      if (!id || typeof id !== "string") {
        return null;
      }
      const rows = await db.select<Row>(
        "SELECT * FROM flight_schools WHERE id = ?",
        [id],
      );
      const row = rows[0];
      return row ? map(row) : null;
    },

    async create(input: NewFlightSchool): Promise<FlightSchool> {
      const name = validateName(input.name);
      const hourlyCostCents = validateCost(input.hourlyCostCents);
      const aircraftDescription = validateText(
        input.aircraftDescription,
        2000,
        "Aircraft description",
      );
      const trainingTrack = validateTrack(input.trainingTrack);
      const availabilityDescription = validateText(
        input.availabilityDescription,
        2000,
        "Availability description",
      );
      const discoveryFlightReflection = validateText(
        input.discoveryFlightReflection,
        20000,
        "Discovery flight reflection",
      );

      const timestamp = nowIso();
      const school: FlightSchool = {
        id: newId(),
        name,
        hourlyCostCents,
        aircraftDescription,
        trainingTrack,
        availabilityDescription,
        discoveryFlightReflection,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await db.execute(
        `INSERT INTO flight_schools (
          id, name, hourly_cost_cents, aircraft_description, training_track,
          availability_description, discovery_flight_reflection, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          school.id,
          school.name,
          school.hourlyCostCents,
          school.aircraftDescription,
          school.trainingTrack,
          school.availabilityDescription,
          school.discoveryFlightReflection,
          school.createdAt,
          school.updatedAt,
        ],
      );

      return school;
    },

    async update(id: Id, changes: UpdateFlightSchool): Promise<void> {
      if (!id || typeof id !== "string") {
        throw new Error("A valid flight school id is required for update.");
      }

      const rows = await db.select<Row>(
        "SELECT * FROM flight_schools WHERE id = ?",
        [id],
      );
      const existingRow = rows[0];
      if (!existingRow) {
        throw new Error(`Flight school with id '${id}' no longer exists.`);
      }

      const current = map(existingRow);

      const name = changes.name !== undefined ? validateName(changes.name) : current.name;
      const hourlyCostCents =
        changes.hourlyCostCents !== undefined
          ? validateCost(changes.hourlyCostCents)
          : current.hourlyCostCents;
      const aircraftDescription =
        changes.aircraftDescription !== undefined
          ? validateText(changes.aircraftDescription, 2000, "Aircraft description")
          : current.aircraftDescription;
      const trainingTrack =
        changes.trainingTrack !== undefined
          ? validateTrack(changes.trainingTrack)
          : current.trainingTrack;
      const availabilityDescription =
        changes.availabilityDescription !== undefined
          ? validateText(changes.availabilityDescription, 2000, "Availability description")
          : current.availabilityDescription;
      const discoveryFlightReflection =
        changes.discoveryFlightReflection !== undefined
          ? validateText(changes.discoveryFlightReflection, 20000, "Discovery flight reflection")
          : current.discoveryFlightReflection;

      const updatedAt = nowIso();

      await db.execute(
        `UPDATE flight_schools SET
          name = ?,
          hourly_cost_cents = ?,
          aircraft_description = ?,
          training_track = ?,
          availability_description = ?,
          discovery_flight_reflection = ?,
          updated_at = ?
        WHERE id = ?`,
        [
          name,
          hourlyCostCents,
          aircraftDescription,
          trainingTrack,
          availabilityDescription,
          discoveryFlightReflection,
          updatedAt,
          id,
        ],
      );
    },

    async remove(id: Id): Promise<void> {
      if (!id || typeof id !== "string") {
        return;
      }
      await db.execute("DELETE FROM flight_schools WHERE id = ?", [id]);
    },
  };
}
