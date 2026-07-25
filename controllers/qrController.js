import crypto from 'crypto';
import QRRedirect from '../models/QRcoderedirect1.js';
import QRView from '../models/QRcodeviews.js';
/**
 * Hashes IP + User-Agent into a short fingerprint.
 * Used for deduplication — no raw PII stored.
 */
function deviceFingerprint(ip = '', userAgent = '') {
  return crypto
    .createHash('sha256')
    .update(`${ip}|${userAgent}`)
    .digest('hex')
    .slice(0, 32);
}
/**
 * Records a scan in QRcodeviews.
 * - Upserts a document keyed on route.
 * - Only increments `views` if this device fingerprint hasn't been seen before.
 * - Caps the stored device list at 5000 entries to prevent unbounded growth.
 */
export async function recordScan(route, ownerId, ip, userAgent) {
  try {
    const fp = deviceFingerprint(ip, userAgent);
    const existing = await QRView.findOne({ route });
    if (existing && existing.devices.includes(fp)) {
      // Known device — touch timestamp only
      existing.updatedAt = new Date();
      await existing.save();
      return;
    }
    // New device — increment and record fingerprint
    await QRView.findOneAndUpdate(
      { route },
      {
        $inc: { views: 1 },
        $push: {
          devices: {
            $each: [fp],
            $slice: -5000,
          },
        },
        $set: { ownerId, updatedAt: new Date() },
        $setOnInsert: { route },
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    // Non-fatal — never let analytics crash the redirect
    console.error('[qrController] recordScan error:', err.message);
  }
}
/**
 * PUT /dashboard/update-destination
 * Authenticated: updates a QR redirect document owned by the current user.
 */
export const updateDestination = async (req, res) => {
  try {
    const { route, destination_url, page_title, display_message, redirect_delay_seconds } =
      req.body;
    const doc = await QRRedirect.findOne({ route });
    if (!doc) {
      return res.status(403).json({ success: false, error: 'Forbidden: route not found.' });
    }
    if (!doc.ownerId || doc.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Forbidden: you do not own this route.' });
    }
    if (doc.canEdit === false) {
      return res.status(403).json({ success: false, error: 'Forbidden: editing is locked by admin.' });
    }
    doc.destination_url        = destination_url.trim();
    doc.page_title             = page_title.trim();
    doc.display_message        = display_message.trim();

    // FIX: parseInt(0) correctly returns 0, but `0 || 3` evaluates to 3
    // because 0 is falsy in JS — the old `|| 3` fallback was silently
    // overriding an intentional 0 with the default. Checking isNaN()
    // explicitly instead means 0 is respected, and only truly invalid
    // input (empty string, non-numeric text, missing field) falls back
    // to the 3-second default.
    const parsedDelay = parseInt(redirect_delay_seconds, 10);
    doc.redirect_delay_seconds = Math.max(
      0,
      Math.min(15, isNaN(parsedDelay) ? 3 : parsedDelay)
    );

    await doc.save();
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[qrController] updateDestination error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error.' });
  }
};