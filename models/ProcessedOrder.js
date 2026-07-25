/**
 * models/ProcessedOrder.js
 * Idempotency guard — records every Stripe session_id that has already been
 * counted toward sold units and triggered an order confirmation email.
 */

import mongoose from 'mongoose';

const ProcessedOrderSchema = new mongoose.Schema(
  {
    session_id:   { type: String, required: true, unique: true },
    processedAt:  { type: Date,   default: Date.now },
    
    // NEW: Lets a repeat call to /api/verify-session return the correct 
    // "this was cancelled" status instead of silently reporting "paid".
    cancelled:    { type: Boolean, default: false },
    cancelReason: { type: String, default: null },
  },
  {
    collection: 'processed_orders', // Kept your original database collection
    timestamps: true, // Added timestamps in case Claude's code needs them
  }
);

// Auto-delete after 90 days — prevents unbounded collection growth
ProcessedOrderSchema.index({ processedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

const ProcessedOrder = mongoose.models.ProcessedOrder || mongoose.model('ProcessedOrder', ProcessedOrderSchema);

export default ProcessedOrder;