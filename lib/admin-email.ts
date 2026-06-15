import type { EmailDeliveryStatus, UserRequestRow } from "@/lib/google-sheets";

export const primaryAdminEmail = "live.unloan@gmail.com";

export async function sendAdminRequestEmail(request: UserRequestRow) {
  const subject = `[UNLOAN] ${request.requestType} - ${request.portfolioName}`;
  const body = [
    `Portfolio: ${request.portfolioName}`,
    `User: ${request.user}`,
    `Request Type: ${request.requestType}`,
    `Priority: ${request.priority}`,
    `Date Time: ${request.createdAt}`,
    "",
    "Message:",
    request.message,
  ].join("\n");

  const webhookUrl = process.env.ADMIN_EMAIL_WEBHOOK_URL;

  if (!webhookUrl) {
    return {
      status: "Retry Pending" as EmailDeliveryStatus,
      detail: `Email alert queued for ${primaryAdminEmail}. Configure ADMIN_EMAIL_WEBHOOK_URL to send automatically.`,
    };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: primaryAdminEmail,
        subject,
        text: body,
      }),
    });

    if (!response.ok) {
      return {
        status: "Email Failed" as EmailDeliveryStatus,
        detail: `Email webhook returned ${response.status}.`,
      };
    }

    return {
      status: "Email Sent" as EmailDeliveryStatus,
      detail: `Email sent to ${primaryAdminEmail}.`,
    };
  } catch (error) {
    return {
      status: "Email Failed" as EmailDeliveryStatus,
      detail: error instanceof Error ? error.message : "Email webhook failed.",
    };
  }
}
