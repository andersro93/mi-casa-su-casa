function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveSenderAddress(env: Env) {
  const sender = env.OUTBOUND_EMAIL_FROM?.trim();

  if (!sender) {
    throw new Error(
      "OUTBOUND_EMAIL_FROM must be configured before sending email.",
    );
  }

  return sender;
}

export async function sendTransactionalEmail(
  env: Env,
  message: Omit<TransactionalEmailMessage, "from">,
) {
  return env.EMAIL.send({
    from: resolveSenderAddress(env),
    ...message,
  });
}

export async function sendPasswordResetEmail(
  env: Env,
  input: {
    to: string;
    resetUrl: string;
    recipientName?: string | null;
  },
) {
  const recipientName = input.recipientName?.trim() || "there";
  const safeRecipientName = escapeHtml(recipientName);
  const safeUrl = escapeHtml(input.resetUrl);

  return sendTransactionalEmail(env, {
    to: input.to,
    subject: "Reset your Mi Casa Su Casa password",
    text: [
      `Hi ${recipientName},`,
      "",
      "We received a request to reset your Mi Casa Su Casa password.",
      `Use this link to choose a new password: ${input.resetUrl}`,
      "",
      "If you did not request this, you can safely ignore this email.",
    ].join("\n"),
    html: `
      <p>Hi ${safeRecipientName},</p>
      <p>We received a request to reset your Mi Casa Su Casa password.</p>
      <p><a href="${safeUrl}">Choose a new password</a></p>
      <p>If you did not request this, you can safely ignore this email.</p>
    `,
  });
}

export async function sendHouseholdInvitationEmail(
  env: Env,
  input: {
    to: string;
    inviteeName: string;
    inviterName: string;
    inviterEmail: string;
    inviteUrl: string;
    expiresAt: string;
    role: "member" | "owner";
  },
) {
  const safeInviteeName = escapeHtml(input.inviteeName);
  const safeInviterName = escapeHtml(input.inviterName);
  const safeInviterEmail = escapeHtml(input.inviterEmail);
  const safeInviteUrl = escapeHtml(input.inviteUrl);
  const roleLabel = input.role === "owner" ? "Owner" : "Member";

  return sendTransactionalEmail(env, {
    to: input.to,
    subject: `${input.inviterName} invited you to Mi Casa Su Casa`,
    text: [
      `Hi ${input.inviteeName},`,
      "",
      `${input.inviterName} (${input.inviterEmail}) invited you to join Mi Casa Su Casa as a ${roleLabel}.`,
      `Accept the invitation here: ${input.inviteUrl}`,
      `This invite expires on ${input.expiresAt}.`,
    ].join("\n"),
    html: `
      <p>Hi ${safeInviteeName},</p>
      <p>${safeInviterName} (${safeInviterEmail}) invited you to join Mi Casa Su Casa as a ${escapeHtml(roleLabel)}.</p>
      <p><a href="${safeInviteUrl}">Accept your invitation</a></p>
      <p>This invite expires on ${escapeHtml(input.expiresAt)}.</p>
    `,
  });
}
