import mongoose from 'mongoose';

const qrViewSchema = new mongoose.Schema({
  route: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  views: {
    type: Number,
    default: 0,
  },
  // Hashed device fingerprints — IP + User-Agent hashed with SHA-256.
  // Never stores raw PII; used only for deduplication.
  devices: {
    type: [String],
    default: [],
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

const QRView =
  mongoose.models.QRcodeviews ||
  mongoose.model('QRcodeviews', qrViewSchema, 'QRcodeviews');

export default QRView;
