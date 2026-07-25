import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
  productId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  rating:      { type: Number, required: true, min: 1, max: 5 },
  displayName: { type: String, default: '', maxlength: 60 },
  reviewText:  { type: String, default: '', maxlength: 2000 },
  createdAt:   { type: Date, default: Date.now },
}, { _id: true });

// NEW: one entry per checkout, per product_type purchased. This is what
// feeds the admin dashboard's "Recent Orders" panel — no separate Orders
// collection needed, and it stays inside the same isolated GiftEmail
// table you're already using for gifting/route assignment.
const orderRecordSchema = new mongoose.Schema({
  productType: { type: String, required: true },
  quantity:    { type: Number, required: true, min: 1 },
  sessionId:   { type: String, default: null }, // Stripe checkout session id, for traceability
  timestamp:   { type: Date, default: Date.now },
}, { _id: false });

const giftEmailSchema = new mongoose.Schema({
  email:       { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
  ownerId:     { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  displayName: { type: String, default: 'User', maxlength: 60 },
  profilePic:  { type: String, default: 'https://www.gravatar.com/avatar/?d=mp&s=200' },
  reviews:     { type: [reviewSchema], default: [] },
  orders:      { type: [orderRecordSchema], default: [] },
}, { timestamps: true });

const GiftEmail = mongoose.model('GiftEmail', giftEmailSchema);
export default GiftEmail;