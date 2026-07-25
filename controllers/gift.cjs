const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const validator = require('validator');
const GiftEmail = require('../models/GiftEmail.js').default;
const QRRedirect = require('../models/QRcoderedirect1.js').default;

exports.giftSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? String(req.user._id) : ipKeyGenerator(req.ip)),
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many searches. Please wait a moment and try again.' });
  },
});

exports.giftTransferLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? String(req.user._id) : ipKeyGenerator(req.ip)),
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many gift attempts. Please wait a moment and try again.' });
  },
});

/**
 * GET /gift
 */
exports.getGiftPage = async (req, res, next) => {
  try {
    const myRoutes = await QRRedirect.find({ ownerId: req.user._id })
      .select('route company_name hardcoded_url product_type')
      .lean();

    res.render('gift', {
      title: 'Gift a Route',
      user: req.user,
      myRoutes,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /gift/search
 * Body: { email }
 * ONLY queries GiftEmail — never the users collection.
 */
exports.postGiftSearch = async (req, res) => {
  const { email } = req.body;

  if (!email || typeof email !== 'string' || !validator.isEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const normalizedEmail = validator.normalizeEmail(email, { gmail_remove_dots: false });

  if (
    req.user &&
    req.user.email &&
    normalizedEmail === validator.normalizeEmail(req.user.email, { gmail_remove_dots: false })
  ) {
    return res.status(400).json({ error: "You can't gift a route to yourself." });
  }

  try {
    const record = await GiftEmail.findOne({ email: normalizedEmail })
      .select('email displayName profilePic -_id')
      .lean();

    if (!record) {
      return res.json({ found: false });
    }

    return res.json({
      found: true,
      email: record.email,
      displayName: record.displayName || 'User',
      profilePic: record.profilePic || 'https://www.gravatar.com/avatar/?d=mp&s=200',
    });
  } catch (err) {
    console.error('POST /gift/search error:', err.message);
    return res.status(500).json({ error: 'Search failed. Please try again.' });
  }
};

/**
 * POST /gift/transfer
 * Body: { route, recipientEmail }
 *
 * 1. Verifies the logged-in user owns `route`.
 * 2. Looks up the recipient's ownerId DIRECTLY from GiftEmail — no users
 *    collection query anywhere in this flow.
 * 3. Reassigns ownerId on the route document.
 */
exports.postGiftTransfer = async (req, res) => {
  const { route, recipientEmail } = req.body;

  if (!route || typeof route !== 'string') {
    return res.status(400).json({ error: 'Missing route.' });
  }
  if (!recipientEmail || !validator.isEmail(recipientEmail)) {
    return res.status(400).json({ error: 'Please provide a valid recipient email.' });
  }

  const normalizedEmail = validator.normalizeEmail(recipientEmail, { gmail_remove_dots: false });

  if (
    req.user.email &&
    normalizedEmail === validator.normalizeEmail(req.user.email, { gmail_remove_dots: false })
  ) {
    return res.status(400).json({ error: "You can't gift a route to yourself." });
  }

  try {
    // 1. Verify ownership
    const qrDoc = await QRRedirect.findOne({ route, ownerId: req.user._id });
    if (!qrDoc) {
      return res.status(403).json({ error: 'You do not own this route, or it does not exist.' });
    }

    // 2. Resolve recipient's ownerId straight from GiftEmail
    const giftRecord = await GiftEmail.findOne({ email: normalizedEmail })
      .select('ownerId email -_id')
      .lean();

    if (!giftRecord || !giftRecord.ownerId) {
      return res.status(404).json({ error: 'That email is not registered.' });
    }

    // 3. Atomic ownership reassignment
    qrDoc.ownerId = giftRecord.ownerId;
    await qrDoc.save();

    return res.json({ success: true, message: `Route gifted to ${normalizedEmail}.` });
  } catch (err) {
    console.error('POST /gift/transfer error:', err.message);
    return res.status(500).json({ error: 'Transfer failed. Please try again.' });
  }
};