// PRATO 3D: o que o painel recebe da API (routes/dish3d.ts).
export type Dish3dCredits = { cost: number; balance: number };

export type Dish3dProductRow = {
  id: string;
  name: string;
  category: string | null;
  imageUrl: string | null;
  model3dUrl: string | null;
  published: boolean;
  generating: boolean;
  lastError: string | null;
};

export type Dish3dList = { available: boolean; credits: Dish3dCredits; products: Dish3dProductRow[] };

export type Dish3dJob = { id: string; status: "RUNNING" | "SUCCEEDED" | "FAILED"; error: string | null; credits: number; photoCount: number; createdAt: string; finishedAt: string | null };

export type Dish3dDetail = { available: boolean; model: { url: string; published: boolean } | null; job: Dish3dJob | null; credits: Dish3dCredits };
