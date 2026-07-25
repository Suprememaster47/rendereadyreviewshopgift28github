const mongoose = require('mongoose');

const qrRouteSchema = new mongoose.Schema({
  route: { type: String, required: true, unique: true },
  company_name: String,
  page_title: String, // This is the fix you need!
  hardcoded_url: String,
  destination_url: String,
  redirect_delay_seconds: Number,
  display_message: String,
  active: { type: Boolean, default: true }
}, { 
  timestamps: true // This will automatically add createdAt and updatedAt
});

module.exports = mongoose.model('QrRoute', qrRouteSchema);