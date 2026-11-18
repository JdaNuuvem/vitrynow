// Finalidades que a API protege com confirmação por código (SEC-13). Cada ação irreversível ou sensível do dono tem a sua.
export type MfaPurpose = "refund" | "change_password" | "delete_user" | "device_token_create" | "device_token_revoke" | "cancel_subscription" | "invite_owner";

export type MfaChallenge = {
  challengeId: string;
  expiresAt: string;
  maskedEmail: string;
};

export const MFA_REQUIRED_CODE = "MFA_REQUIRED";
