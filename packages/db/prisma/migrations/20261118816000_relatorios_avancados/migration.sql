-- API-45 entregue (GET /api/reports/advanced): o PRO passa a listar `advanced_reports`.
UPDATE "Plan" SET "features" = array_append("features", 'advanced_reports')
WHERE "code" = 'PRO' AND NOT ('advanced_reports' = ANY("features"));
