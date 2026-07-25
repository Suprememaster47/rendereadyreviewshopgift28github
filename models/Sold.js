/**
 * models/Sold.js
 * Tracks how many units have been sold for each product.
 *
 * Collection: "sold" (MongoDB Atlas, Cluster login1, DB: test)
 *
 * Seed the collection in Atlas with one document per product:
 * [
 *   { "slug": "acme-circles-t-shirt", "name": "Acme Circles T-Shirt", "units_sold": 0 },
 *   { "slug": "acme-storm-hoodie",    "name": "Acme Storm Hoodie",    "units_sold": 0 },
 *   { "slug": "lightning-cap",        "name": "Lightning Cap",        "units_sold": 0 },
 *   { "slug": "acme-minimalist-mug",  "name": "Acme Minimalist Mug", "units_sold": 0 }
 * ]
 *
 * units_sold is incremented atomically with $inc each time a payment is
 * confirmed. The ProcessedOrder model prevents double-counting on reloads.
 */

import mongoose from 'mongoose';

const SoldSchema = new mongoose.Schema(
  {
    slug:       { type: String, required: true, unique: true, trim: true, lowercase: true },
    name:       { type: String, required: true, trim: true },
    units_sold: { type: Number, default: 0, min: 0 },
  },
  {
    collection: 'sold',
    timestamps: false,
  }
);

const Sold = mongoose.models.Sold || mongoose.model('Sold', SoldSchema);

export default Sold;
