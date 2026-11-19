export type MfaPurpose = "refund" | "change_password" | "delete_user" | "connect_payment" | "disconnect_payment" | "device_token_create" | "device_token_revoke" | "cancel_subscription" | "invite_owner" | "anonymize_customer" | "export_customer";

export type MfaChallenge = {
  challengeId: string;
  expiresAt: string;
  maskedEmail: string;
};

export const MFA_REQUIRED_CODE = "MFA_REQUIRED";
