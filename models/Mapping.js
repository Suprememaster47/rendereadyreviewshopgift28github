/**
 * models/Mapping.js
 * Mongoose schema for the "mapping" collection (MongoDB Atlas, DB: test).
 *
 * The mapping document maps URL paths → product titles:
 * {
 *   "/shop/collections/acme-circles-t-shirt": "Acme Circles T-Shirt",
 *   ...
 * }
 *
 * This collection is READ-ONLY from the application's perspective.
 * Only you (the developer) can change it via MongoDB Atlas directly.
 *
 * strict: false lets Mongoose read the arbitrary dynamic URL-path keys
 * without needing to enumerate them in the schema.
 */

import mongoose from 'mongoose';

const MappingSchema = new mongoose.Schema(
  {},
  {
    collection: 'mapping',
    strict: false,
  }
);

const Mapping = mongoose.models.Mapping || mongoose.model('Mapping', MappingSchema);

export default Mapping;
