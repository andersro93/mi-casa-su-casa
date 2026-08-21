import { createHousehold } from "@server/db/repositories/households";
import { getInvitationById } from "@server/db/repositories/invitations";
import { createProvider } from "@server/db/repositories/provider-rules";
import { inviteMember, resendInvitation } from "@server/domain/invitations";
import { describe, expect, it } from "vitest";

import { count, createTestUser, db, testEnv } from "./helpers";

describe("invitation service", () => {
  it("creates, emails and resends invitations with provider scope preserved", async () => {
    const owner = await createTestUser({
      email: "owner@example.com",
      name: "Olivia",
    });
    const household = await createHousehold(db, {
      slug: "casa",
      displayName: "Casa",
      ownerUserId: owner.id,
    });
    const householdId = household?.id ?? "";
    const provider = await createProvider(
      db,
      householdId,
      "netflix",
      "Netflix",
    );
    const sent: Array<{ to: unknown; subject: unknown }> = [];
    const env = testEnv({
      EMAIL: {
        send: async (message: { to: unknown; subject: unknown }) => {
          sent.push({ to: message.to, subject: message.subject });
          return { messageId: "m" };
        },
      } as unknown as Env["EMAIL"],
    });
    const inviter = {
      id: owner.id,
      name: "Olivia",
      email: "owner@example.com",
    };

    const result = await inviteMember(db, env, householdId, inviter, {
      email: "kid@example.com",
      name: "Kid",
      role: "member",
      providerIds: [provider.id],
    });

    expect(result).toMatchObject({
      emailSent: true,
      invitation: {
        email: "kid@example.com",
        role: "member",
        status: "pending",
      },
    });
    expect(result?.inviteUrl).toMatch(
      /^http:\/\/localhost:8787\/invite\/[a-f0-9-]{36}$/,
    );
    expect(sent).toEqual([
      { to: "kid@example.com", subject: expect.stringContaining("invited") },
    ]);
    expect(result?.invitation.providers.map((p) => p.provider_key)).toEqual([
      "netflix",
    ]);

    const resent = await resendInvitation(
      db,
      env,
      householdId,
      inviter,
      result?.invitation.id ?? "",
    );
    expect(resent?.invitation.id).not.toBe(result?.invitation.id);
    expect(resent?.invitation.providers.map((p) => p.provider_key)).toEqual([
      "netflix",
    ]);
    expect(
      (await getInvitationById(db, householdId, result?.invitation.id ?? ""))
        ?.status,
    ).toBe("cancelled");
    expect(await count("household_invitations", "status = 'pending'")).toBe(1);
    expect(sent).toHaveLength(2);
  });

  it("reports a failed delivery without losing the invitation", async () => {
    const owner = await createTestUser({ email: "owner@example.com" });
    const household = await createHousehold(db, {
      slug: "casa",
      displayName: "Casa",
      ownerUserId: owner.id,
    });
    const env = testEnv({
      EMAIL: {
        send: async () => {
          throw new Error("binding down");
        },
      } as unknown as Env["EMAIL"],
    });

    const result = await inviteMember(
      db,
      env,
      household?.id ?? "",
      {
        id: owner.id,
        name: "Owner",
        email: "owner@example.com",
      },
      { email: "kid@example.com", name: "Kid", role: "owner", providerIds: [] },
    );

    expect(result).toMatchObject({
      emailSent: false,
      emailError: "binding down",
    });
    expect(await count("household_invitations")).toBe(1);
  });
});
