export type OptionGroupInput = {
  name: string;
  helpText: string | null;
  minSelect: number;
  maxSelect: number | null;
  maxPerOption: number;
  priceMode: "SUM" | "BASE";
  options: { id?: string; name: string; priceCents: number; active: boolean }[];
};

export type OptionGroup = Omit<OptionGroupInput, "options"> & {
  id: string;
  source?: "MANUAL" | "LEGACY_ADDITIONALS";
  productCount?: number;
  options: (OptionGroupInput["options"][number] & { id: string })[];
};

export type GroupChange = { group: OptionGroup; warnings: { code: string; message: string }[] };

export type ProductGroups = {
  groups: OptionGroup[];
  fromPriceCents: number | null;
  unavailableBecause: { groupId: string; name: string }[];
};
