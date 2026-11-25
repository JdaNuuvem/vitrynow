import { describe, expect, it } from "vitest";
import { FEATURE_LABELS, UNKNOWN_FEATURE_LABEL, featureLabel } from "./planPresentation";

describe("featureLabel: a tela Planos nunca mostra o código interno do recurso", () => {
  it("todo recurso conhecido tem nome em português", () => {
    for (const code of ["multi_user", "table_qr", "tab_service", "scheduled_orders", "advanced_reports", "whatsapp_auto"]) {
      expect(featureLabel(code)).toBe(FEATURE_LABELS[code]);
      expect(featureLabel(code)).not.toMatch(/_/);
    }
  });

  it("código novo ainda sem nome vira um texto genérico, nunca o código cru", () => {
    expect(featureLabel("recurso_futuro")).toBe(UNKNOWN_FEATURE_LABEL);
    expect(featureLabel("toString")).toBe(UNKNOWN_FEATURE_LABEL);
  });
});
