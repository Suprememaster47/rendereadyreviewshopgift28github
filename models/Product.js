import mongoose from 'mongoose';

const productSchema = new mongoose.Schema({
  title:              { type: String, required: true },
  product_type:       { type: String, required: true, index: true },
  slug:               { type: String, required: true, unique: true, index: true },
  priceUSD:           { type: Number, required: true, min: 0 }, // Buy 1 (single unit) price
  sizes:              { type: [String], default: [] },
  colors:             { type: [String], default: [] },
  images:             { type: [String], default: [] },
  inStock:            { type: Boolean, default: true },
  category:           { type: String, required: true, index: true },
  quantityRemaining:  { type: Number, default: 0, min: 0 },

  // NEW: bundle/tier pricing. Each is the TOTAL price for buying that many
  // units together (not per-unit) — e.g. priceTier2Total: 44.99 means
  // "2 units for $44.99 total". Leave blank/null to fall back to linear
  // pricing (priceUSD * quantity, no discount) for that tier.
  priceTier2Total:    { type: Number, default: null, min: 0 },
  priceTier3Total:    { type: Number, default: null, min: 0 },
}, { timestamps: true });

const Product = mongoose.models.Product
  || mongoose.model('Product', productSchema, 'products');

export default Product;