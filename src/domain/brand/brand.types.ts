import type { Product } from "../product/product.types";
import type { Asset } from "../asset/asset.types";

export interface Brand {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
  products?: Product[];
  assets?: Asset[];
}

export interface UpdateBrandInput {
  name?: string;
  slug?: string;
}
