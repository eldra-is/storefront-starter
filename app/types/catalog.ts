/**
 * Storefront views of the SDK's contract types, derived rather than retyped.
 * The only difference from the wire shape is that nullable lists arrive as arrays.
 */
import type {
  EldraCategory,
  EldraCollection,
  EldraProductDetails,
  EldraProductListItem,
  EldraProductMediaLink,
  EldraProductOption,
  EldraProductOptionValue,
  EldraProductVariant,
} from '@eldrajs/sdk';

export type Category = EldraCategory;
export type Collection = EldraCollection;
export type ProductListItem = EldraProductListItem;
export type ProductVariant = EldraProductVariant;
export type ProductOption = Omit<EldraProductOption, 'values'> & {
  values: EldraProductOptionValue[];
};
export type ProductDetail = Omit<EldraProductDetails, 'variants' | 'options'> & {
  variants: ProductVariant[];
  options: ProductOption[];
};
export type GalleryImage = Pick<EldraProductMediaLink, 'assetId' | 'url' | 'altText' | 'sortOrder'>;
