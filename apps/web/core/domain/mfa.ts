export type MfaPurpose = "refund" | "change_password" | "delete_user";

export type MfaChallenge = {
  challengeId: string;
  expiresAt: string;
  maskedEmail: string;
};

export const MFA_REQUIRED_CODE = "MFA_REQUIRED";
