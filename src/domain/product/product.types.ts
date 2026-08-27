export interface ProductAlias {
  id: string;
  productId: string;
  alias: string;
  normalizedAlias: string;
  createdAt: Date;
}

export interface Product {
  id: string;
  brandId: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  aliases?: ProductAlias[];
}

export interface CreateProductInput {
  brandId: string;
  name: string;
  slug?: string;
  description?: string | null;
}

export interface UpdateProductInput {
  name?: string;
  slug?: string;
  description?: string | null;
}

export interface AddAliasInput {
  productId: string;
  alias: string;
}
