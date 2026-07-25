import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
  productType:  { type: String, required: true },
  productName:  String,
  slug:         String,
  quantity:     { type: Number, required: true, min: 1 },
  unitAmount:   Number, // cents
  totalAmount:  Number, // cents
}, { _id: false });

const orderSchema = new mongoose.Schema({
  sessionId:     { type: String, required: true, unique: true, index: true },
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  customerEmail: { type: String, required: true, index: true },
  customerName:  { type: String, default: '' },
  items:         { type: [orderItemSchema], default: [] },
  amountTotal:   { type: Number, required: true }, // cents

  status: {
    type: String,
    enum: ['processing', 'shipped', 'delivered'],
    default: 'processing',
    index: true,
  },

  shippedAt:   { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
}, { timestamps: true });

// Convenience: is this order >= 5 days past shipping?
orderSchema.methods.isArrivingSoon = function () {
  if (!this.shippedAt) return false;
  const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
  return Date.now() - this.shippedAt.getTime() >= fiveDaysMs;
};

const Order = mongoose.model('Order', orderSchema);
export default Order;