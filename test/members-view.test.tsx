import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MembersView } from "../src/client/components/MembersView";

describe("MembersView", () => {
  it("renders direct member creation and invitation management controls", () => {
    const html = renderToStaticMarkup(
      <MembersView
        members={[
          {
            id: "member-1",
            email: "member@example.com",
            name: "Family Member",
            role: "member",
            createdAt: "2026-05-10T12:00:00.000Z",
            updatedAt: "2026-05-10T12:00:00.000Z",
            providerAccess: [
              {
                providerKey: "netflix",
                displayName: "Netflix",
              },
            ],
          },
        ]}
        invitations={[
          {
            id: "invite-1",
            email: "invitee@example.com",
            name: "Invitee",
            role: "member",
            status: "pending",
            invitedByUserId: "admin-1",
            acceptedByUserId: null,
            expiresAt: "2026-05-31T12:00:00.000Z",
            acceptedAt: null,
            cancelledAt: null,
            createdAt: "2026-05-10T12:00:00.000Z",
            updatedAt: "2026-05-10T12:00:00.000Z",
            providers: [
              {
                id: "provider-1",
                provider_key: "netflix",
                display_name: "Netflix",
              },
            ],
          },
        ]}
        providerOptions={[
          {
            id: "provider-1",
            provider_key: "netflix",
            display_name: "Netflix",
          },
        ]}
        selectedMemberId="member-1"
        onSelectMember={vi.fn()}
        isLoadingMembers={false}
        memberFormState={{
          email: "",
          name: "",
          password: "",
          role: "member",
        }}
        onMemberFormChange={vi.fn()}
        onCreateMember={vi.fn()}
        isSavingMember={false}
        invitationFormState={{
          email: "invitee@example.com",
          name: "Invitee",
          role: "member",
          providerIds: ["provider-1"],
        }}
        onInvitationFormChange={vi.fn()}
        onCreateInvitation={vi.fn()}
        onResendInvitation={vi.fn()}
        onCancelInvitation={vi.fn()}
        isSavingInvitation={false}
        onRoleChange={vi.fn()}
        onProviderAccessToggle={vi.fn()}
      />,
    );

    expect(html).toContain("Create a household member");
    expect(html).toContain("Invite a household member");
    expect(html).toContain("Send invitation");
    expect(html).toContain("Pending and recent invitations");
    expect(html).toContain("Resend");
    expect(html).toContain("Cancel");
    expect(html).toContain("Family Member");
    expect(html).toContain("Provider Access");
  });
});
