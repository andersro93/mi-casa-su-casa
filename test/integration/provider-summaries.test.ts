import { provisioningAuthForEnv } from "@server/auth/auth";
import { createHousehold } from "@server/db/repositories/households";
import { listProviderSummariesForUser } from "@server/db/repositories/messages";
import { createProvider } from "@server/db/repositories/provider-rules";
import { describe, expect, it } from "vitest";

import { db, testEnv } from "./helpers";

async function ownerWithHousehold() {
  const result = await provisioningAuthForEnv(testEnv()).api.signUpEmail({
    body: {
      email: "owner@example.com",
      name: "Owner",
      password: "averylongpassword123",
    },
  });
  const household = await createHousehold(db, {
    slug: "casa",
    displayName: "Casa",
    ownerUserId: result.user.id,
  });
  return { userId: result.user.id, householdId: household?.id ?? "" };
}

async function insertMessage(
  householdId: string,
  providerId: string,
  id: string,
  receivedAt: string,
  fields: { code?: string | null; status?: string; subject?: string },
) {
  await db
    .prepare(
      `INSERT INTO messages (id, household_id, message_id, provider_id, envelope_from, envelope_to,
         from_header, subject, text_body, extracted_code, status, classification_reason, raw_size, received_at, delete_after)
       VALUES (?1, ?2, ?3, ?4, 'a@b.c', 'casa@x.y', 'Netflix <a@b.c>', ?5, 'body', ?6, ?7, 'r', 1, ?8, '2099-01-01T00:00:00.000Z')`,
    )
    .bind(
      id,
      householdId,
      `<${id}@t>`,
      providerId,
      fields.subject ?? null,
      fields.code ?? null,
      fields.status ?? "new",
      receivedAt,
    )
    .run();
}

describe("listProviderSummariesForUser", () => {
  it("includes the newest message (id, subject, code, status) per provider", async () => {
    const { userId, householdId } = await ownerWithHousehold();
    const netflix = await createProvider(db, householdId, "netflix", "Netflix");
    const spotify = await createProvider(db, householdId, "spotify", "Spotify");

    await insertMessage(
      householdId,
      netflix.id,
      "old",
      "2026-01-01T00:00:00.000Z",
      {
        code: "111111",
        status: "used",
        subject: "Old code",
      },
    );
    await insertMessage(
      householdId,
      netflix.id,
      "newest",
      "2026-01-02T00:00:00.000Z",
      {
        code: "482913",
        subject: "Your Netflix verification code",
      },
    );
    await insertMessage(
      householdId,
      netflix.id,
      "middle",
      "2026-01-01T12:00:00.000Z",
      {
        code: null,
        subject: "New sign-in",
      },
    );

    const summaries = await listProviderSummariesForUser(
      db,
      householdId,
      userId,
    );

    expect(summaries.map((s) => s.provider_key).sort()).toEqual([
      "netflix",
      "spotify",
    ]);
    const n = summaries.find((row) => row.provider_key === "netflix");
    const s = summaries.find((row) => row.provider_key === "spotify");
    expect(n).toMatchObject({
      message_count: 3,
      new_count: 2,
      latest_received_at: "2026-01-02T00:00:00.000Z",
      latest_message_id: "newest",
      latest_subject: "Your Netflix verification code",
      latest_code: "482913",
      latest_status: "new",
    });
    // A provider without messages has null latest fields, not missing keys.
    expect(s).toMatchObject({
      provider_key: "spotify",
      message_count: 0,
      latest_received_at: null,
      latest_message_id: null,
      latest_subject: null,
      latest_code: null,
      latest_status: null,
    });
    expect(spotify.id).toBeTruthy();
  });
});
